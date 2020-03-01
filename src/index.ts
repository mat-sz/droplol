#!/usr/bin/env node
import { readFileSync } from 'fs';
import { basename } from 'path';
import { v4 as uuid } from 'uuid';
import { TypeSocket } from 'typesocket';
import { fromBuffer } from 'file-type';
import * as wrtc from 'wrtc';
import WebSocket from 'ws';
import cliProgress from 'cli-progress';
import colors from 'colors';
import commandLineArgs from 'command-line-args';

import { MessageModel, WelcomeMessageModel, NameMessageModel, PingMessageModel, NetworkMessageModel, RTCDescriptionMessageModel, RTCCandidateMessageModel, TransferMessageModel, ActionMessageModel } from './types/Models';
import { MessageType, ActionMessageActionType } from './types/MessageType';

console.log(colors.magenta(colors.bold('drop.lol CLI | GH: https://github.com/mat-sz/droplol')));

const optionDefinitions = [
    { name: 'file', type: String, defaultOption: true },
    { name: 'name', alias: 'n', type: String },
    { name: 'help', alias: 'h', type: Boolean }
];
const options = commandLineArgs(optionDefinitions);

if (!options.file && !options.help) {
    console.error('Providing a file path is mandatory.');
}

if (options.help || !options.file) {
    console.log('Usage: npx droplol file [-n network]');
    console.log('  --help, -h     prints help');
    console.log('  --network, -n  sets network name');
    process.exit(0);
}

const nameCharacterSet = 'CEFGHJKMNPQRTVWXY';
const DROP_WS_SERVER = process.env.DROP_WS_SERVER || 'wss://drop.lol/ws/';
const DROP_ADDRESS = process.env.DROP_ADDRESS || 'https://drop.lol/';
const FILE = options.file;
let networkName = '';

// @ts-ignore This is to make TypeSocket work since it's not isomorphic yet.
global['WebSocket'] = WebSocket;

// @ts-ignore Polyfill node's lack of RTCPeerConnection to simplify code sharing between front end and this.
global['RTCPeerConnection'] = wrtc.RTCPeerConnection;

// Upload
let fileBuffer: ArrayBuffer = new Uint8Array(readFileSync(FILE)).buffer;
let fileName = basename(FILE);
let validTransferIds = [uuid()];
let clientsContacted: string[] = [];
let transferInProgress = false;
let cancellationMessages: ActionMessageModel[] = [];

let clientId: string;
let connections: { [k: string]: RTCPeerConnection } = {};
let rtcConfiguration: RTCConfiguration;

const bar = new cliProgress.SingleBar({
    format: '[Transfer] Progress: |' + colors.cyan('{bar}') + '| {percentage}% || Speed: {speed}',
}, cliProgress.Presets.rect);

function sendFile(transferId: string, clientId: string) {
    const connection = new RTCPeerConnection(rtcConfiguration);
    connections[transferId] = connection;

    for (let message of cancellationMessages) {
        if (message.transferId !== transferId) {
            socket.send(message);
        }
    }

    connection.addEventListener('negotiationneeded', async () => {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        const nextRtcMessage: RTCDescriptionMessageModel = {
            type: MessageType.RTC_DESCRIPTION,
            transferId: transferId,
            targetId: clientId,
            data: {
                type: offer.type,
                sdp: offer.sdp,
            },
        };

        socket.send(nextRtcMessage);
    });

    connection.addEventListener('icecandidate', (e) => {
        if (!e || !e.candidate) return;

        const candidateMessage: RTCCandidateMessageModel = {
            type: MessageType.RTC_CANDIDATE,
            targetId: clientId,
            transferId: transferId,
            data: e.candidate,
        };
        
        socket.send(candidateMessage);
    });

    const channel = connection.createDataChannel('sendDataChannel');
    channel.binaryType = 'arraybuffer';

    const timestamp = new Date().getTime() / 1000;

    let complete = false;
    const onFailure = () => {
        bar.stop();
        complete = true;
        console.log('[Transfer] Transfer failure.');
        process.exit(0);
    };

    const bufferSupported = !!connection.sctp;
    const bufferSize = (bufferSupported && connection.sctp) ? connection.sctp.maxMessageSize : 16384;

    channel.addEventListener('open', () => {
        console.log('[Transfer] Connected, sending file.');
        bar.start(fileBuffer.byteLength, 0, {
            speed: 'N/A'
        });
        let offset = 0;

        const nextSlice = (currentOffset: number) => {
            if (complete) return;
            const buffer = fileBuffer.slice(offset, currentOffset + bufferSize);

            try {
                channel.send(buffer);
            } catch {
                onFailure();
                channel.close();
                return;
            }

            offset += buffer.byteLength;
            bar.update(offset, {
                speed: Math.round(offset/(new Date().getTime() / 1000 - timestamp) / 1000) + ' kB/s'
            });

            if (offset >= fileBuffer.byteLength) {
                bar.stop();
                console.log('[Transfer] File transfer complete.');
                setTimeout(() => {
                    process.exit(0);
                }, 5000);

                complete = true;
            } else if (!bufferSupported) {
                nextSlice(offset);
            }
        };

        if (bufferSupported) {
            channel.bufferedAmountLowThreshold = 0;
            channel.addEventListener('bufferedamountlow', () => nextSlice(offset));
        }

        nextSlice(0);
    });

    channel.addEventListener('close', () => {
        if (!complete) {
            onFailure();
        }

        connection.close();
    });

    connection.addEventListener('iceconnectionstatechange', () => {
        if ((connection.iceConnectionState === 'failed' ||
            connection.iceConnectionState === 'disconnected') && !complete) {
            onFailure();
        }
    });
}

const socket = new TypeSocket<MessageModel>(DROP_WS_SERVER, {
    maxRetries: 0,
    retryOnClose: false,
});

socket.on('connected', () => {
    console.log('[Connection] Connected to server: ' + DROP_WS_SERVER);
});

socket.on('message', async (msg) => {
    switch (msg.type) {
        case MessageType.WELCOME:
            const welcomeMessage = msg as WelcomeMessageModel;
            clientId = welcomeMessage.clientId;
            rtcConfiguration = welcomeMessage.rtcConfiguration || {};
            networkName = welcomeMessage.suggestedName || new Array(5).fill('').map(() => nameCharacterSet.charAt(Math.floor(Math.random() * nameCharacterSet.length))).join('');

            socket.send({
                type: 'name',
                networkName: networkName
            } as NameMessageModel);
            break;
        case MessageType.NETWORK:
            const networkMessage = msg as NetworkMessageModel;
            console.log('[Connection] Available clients: ' + (networkMessage.clients.length - 1));
            if (networkMessage.clients.length > 1) {
                const clients = networkMessage.clients.filter((client) => client.clientId !== clientId);
                if (!transferInProgress) {
                    clients.forEach(async (client) => {
                        if (clientsContacted.includes(client.clientId)) return;

                        clientsContacted.push(client.clientId);
                        const transferId = uuid();
                        validTransferIds.push(transferId);
                        
                        socket.send({
                            type: 'transfer',
                            transferId: transferId,
                            targetId: client.clientId,
                            fileName: fileName,
                            fileSize: fileBuffer.byteLength,
                            fileType: (await fromBuffer(fileBuffer))?.mime || 'application/octet-stream',
                        } as TransferMessageModel);

                        cancellationMessages.push({
                            type: MessageType.ACTION,
                            transferId: transferId,
                            targetId: client.clientId,
                            action: ActionMessageActionType.CANCEL,
                        });
                    })
                }
            } else {
                console.log('[Connection] No clients available, open: ' + DROP_ADDRESS + networkName);
            }
            break;
        case MessageType.TRANSFER:
            console.log('[Connection] Incoming transfers are not supported yet.');
            break;
        case MessageType.ACTION:
            const actionMessage: ActionMessageModel = msg as ActionMessageModel;
            switch (actionMessage.action) {
                case ActionMessageActionType.ACCEPT:
                    if (validTransferIds.includes(actionMessage.transferId)) {
                        transferInProgress = true;
                        sendFile(actionMessage.transferId, actionMessage.clientId as string);
                    }
                    break;
                case ActionMessageActionType.REJECT:
                    validTransferIds = validTransferIds.filter((transferId) => transferId !== actionMessage.transferId);
                    break;
            }
            break;
        case MessageType.RTC_DESCRIPTION:
            const rtcMessage: RTCDescriptionMessageModel = msg as RTCDescriptionMessageModel;
            if (rtcMessage.transferId in connections) {
                connections[rtcMessage.transferId].setRemoteDescription(rtcMessage.data);
            }
            break;
        case MessageType.RTC_CANDIDATE:
            const rtcCandidate: RTCCandidateMessageModel = msg as RTCCandidateMessageModel;
            try {
                if (rtcCandidate.transferId in connections) {
                    connections[rtcCandidate.transferId].addIceCandidate(rtcCandidate.data);
                }
            } catch {}
            break;
        case MessageType.PING:
            socket.send({
                type: MessageType.PING,
                timestamp: new Date().getTime(),
            } as PingMessageModel);
            break;
    }
});

socket.connect();
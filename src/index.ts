#!/usr/bin/env node
import { readFileSync } from 'fs';
import { basename } from 'path';
import { v4 as uuid } from 'uuid';
import { TypeSocket } from 'typesocket';
import { fromBuffer } from 'file-type';
import * as wrtc from 'wrtc';
import WebSocket from 'ws';
import colors from 'colors';
import commandLineArgs from 'command-line-args';

import { MessageModel, WelcomeMessageModel, NameMessageModel, PingMessageModel, NetworkMessageModel, RTCDescriptionMessageModel, RTCCandidateMessageModel, TransferMessageModel, ActionMessageModel } from './types/Models';
import { MessageType, ActionMessageActionType } from './types/MessageType';
import { sendFile } from './sendFile';
import { receiveFile } from './receiveFile';

console.log(colors.magenta(colors.bold('drop.lol CLI | GH: https://github.com/mat-sz/droplol')));

const optionDefinitions = [
    { name: 'file', type: String, defaultOption: true },
    { name: 'name', alias: 'n', type: String },
    { name: 'help', alias: 'h', type: Boolean }
];
const options = commandLineArgs(optionDefinitions);

if (options.help) {
    console.log('Usage: npx droplol [file] [-n network]');
    console.log('  --help, -h     prints help');
    console.log('  --network, -n  sets network name');
    console.log('When file is provided, the file is sent and then the program exits.');
    console.log('When no file is provided, the program will receive all files and');
    console.log('save them in the current directory.');
    process.exit(0);
}

const nameCharacterSet = 'CEFGHJKMNPQRTVWXY';
const DROP_WS_SERVER = process.env.DROP_WS_SERVER || 'wss://drop.lol/ws/';
const DROP_ADDRESS = process.env.DROP_ADDRESS || 'https://drop.lol/';
let networkName = '';
let receiveMode = false;

// @ts-ignore This is to make TypeSocket work since it's not isomorphic yet.
global['WebSocket'] = WebSocket;

// @ts-ignore Polyfill node's lack of RTCPeerConnection to simplify code sharing between front end and this.
global['RTCPeerConnection'] = wrtc.RTCPeerConnection;

// Upload
let fileBuffer: ArrayBuffer;
let fileName: string;
let validTransferIds = [uuid()];
let clientsContacted: string[] = [];
let transferInProgress = false;
let cancellationMessages: ActionMessageModel[] = [];

if (options.file) {
    fileBuffer = new Uint8Array(readFileSync(options.file)).buffer;
    fileName = basename(options.file);
} else {
    console.log('[Connection] No file selected, receive mode is enabled.');
    receiveMode = true;
}

// Receive
let transferMessages: { [k: string]: TransferMessageModel } = {};

let clientId: string;
let connections: { [k: string]: RTCPeerConnection } = {};
let rtcConfiguration: RTCConfiguration;


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
            if (networkMessage.clients.length > 1 && fileName && fileBuffer) {
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
            } else if (networkMessage.clients.length <= 1) {
                console.log('[Connection] No clients available, open: ' + DROP_ADDRESS + networkName);
            }
            break;
        case MessageType.TRANSFER:
            const transferMessage: TransferMessageModel = msg as TransferMessageModel;
            if (!receiveMode) {
                console.log('[Connection] Transfer request received but application is running in send mode.');
                socket.send({
                    type: MessageType.ACTION,
                    targetId: transferMessage.clientId as string,
                    transferId: transferMessage.transferId,
                    action: ActionMessageActionType.CANCEL,
                } as ActionMessageModel);
                break;
            }

            transferMessages[transferMessage.transferId] = transferMessage;
            socket.send({
                type: MessageType.ACTION,
                targetId: transferMessage.clientId as string,
                transferId: transferMessage.transferId,
                action: ActionMessageActionType.ACCEPT,
            } as ActionMessageModel);
            break;
        case MessageType.ACTION:
            const actionMessage: ActionMessageModel = msg as ActionMessageModel;
            switch (actionMessage.action) {
                case ActionMessageActionType.ACCEPT:
                    if (validTransferIds.includes(actionMessage.transferId)) {
                        transferInProgress = true;
                        sendFile(actionMessage.transferId, actionMessage.clientId as string, fileBuffer, socket, rtcConfiguration, connections, cancellationMessages);
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
            } else if (rtcMessage.transferId in transferMessages) {
                receiveFile(transferMessages[rtcMessage.transferId], socket, rtcConfiguration, connections, rtcMessage);
            }
            break;
        case MessageType.RTC_CANDIDATE:
            const rtcCandidate: RTCCandidateMessageModel = msg as RTCCandidateMessageModel;
            try {
                if (rtcCandidate.transferId in connections) {
                    await connections[rtcCandidate.transferId].addIceCandidate(rtcCandidate.data);
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
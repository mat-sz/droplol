import cliProgress from 'cli-progress';
import colors from 'colors';
import { TypeSocket } from 'typesocket';
import { writeFileSync } from 'fs';
import { basename } from 'path';

import { MessageModel, RTCDescriptionMessageModel, RTCCandidateMessageModel, TransferMessageModel } from './types/Models';
import { MessageType } from './types/MessageType';

export async function receiveFile(transferMessage: TransferMessageModel, socket: TypeSocket<MessageModel>, rtcConfiguration: RTCConfiguration, connections: { [k: string]: RTCPeerConnection }, rtcMessage: RTCDescriptionMessageModel) {
    const bar = new cliProgress.SingleBar({
        format: '[Transfer] Progress: |' + colors.cyan('{bar}') + '| {percentage}% || Speed: {speed}',
    }, cliProgress.Presets.rect);

    const connection = new RTCPeerConnection(rtcConfiguration);
    connections[transferMessage.transferId] = connection;

    connection.addEventListener('icecandidate', (e) => {
        if (!e || !e.candidate) return;

        const candidateMessage: RTCCandidateMessageModel = {
            type: MessageType.RTC_CANDIDATE,
            targetId: transferMessage.clientId as string,
            transferId: transferMessage.transferId,
            data: e.candidate,
        };
        
        socket.send(candidateMessage);
    });

    const timestamp = new Date().getTime() / 1000;
    let buffer: Uint8Array = new Uint8Array(0);
    let offset = 0;

    let complete = false;
    const onFailure = () => {
        complete = true;
        console.log('[Transfer] Transfer failed.');
    };

    const onComplete = () => {
        complete = true;

        bar.stop();
        console.log('[Transfer] Complete.');
        writeFileSync(basename(transferMessage.fileName), buffer);

        connection.close();
    };

    connection.addEventListener('datachannel', (event) => {
        console.log('[Transfer] Connected.');
        bar.start(transferMessage.fileSize, 0, {
            speed: 'N/A'
        });

        const channel = event.channel;

        channel.binaryType = 'arraybuffer';
        channel.addEventListener('message', (event) => {
            const array = new Uint8Array(event.data);
            const tempBuffer = new Uint8Array(buffer.length + array.length);
            tempBuffer.set(buffer, 0);
            tempBuffer.set(array, buffer.length);
            buffer = tempBuffer;

            offset += event.data.byteLength;

            bar.update(offset, {
                speed: Math.round(offset/(new Date().getTime() / 1000 - timestamp) / 1000) + ' kB/s'
            });

            if (offset >= transferMessage.fileSize) {
                onComplete();
                channel.close();
            }
        });

        channel.addEventListener('close', () => {
            if (offset < transferMessage.fileSize) {
                onFailure();
            } else if (!complete) {
                onComplete();
            }
        });
    });

    connection.addEventListener('iceconnectionstatechange', () => {
        if ((connection.iceConnectionState === 'failed' ||
            connection.iceConnectionState === 'disconnected') && !complete) {
            onFailure();
        }
    });

    await connection.setRemoteDescription(rtcMessage.data);

    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);

    const nextRtcMessage: RTCDescriptionMessageModel = {
        type: MessageType.RTC_DESCRIPTION,
        transferId: transferMessage.transferId,
        targetId: transferMessage.clientId as string,
        data: {
            type: connection.localDescription?.type,
            sdp: connection.localDescription?.sdp,
        },
    };

    socket.send(nextRtcMessage);
}
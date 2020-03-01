import cliProgress from 'cli-progress';
import colors from 'colors';
import { TypeSocket } from 'typesocket';

import { MessageModel, RTCDescriptionMessageModel, RTCCandidateMessageModel, ActionMessageModel } from './types/Models';
import { MessageType } from './types/MessageType';

export function sendFile(transferId: string, clientId: string, fileBuffer: ArrayBuffer, socket: TypeSocket<MessageModel>, rtcConfiguration: RTCConfiguration, connections: { [k: string]: RTCPeerConnection }, cancellationMessages: ActionMessageModel[]) {
    const bar = new cliProgress.SingleBar({
        format: '[Transfer] Progress: |' + colors.cyan('{bar}') + '| {percentage}% || Speed: {speed}',
    }, cliProgress.Presets.rect);

    
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
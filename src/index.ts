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
import { RSA } from 'matcrypt';
import { Crypto } from 'node-webcrypto-ossl';

global['crypto'] = new Crypto();

import {
  NameMessageModel,
  PingMessageModel,
  TransferMessageModel,
  ActionMessageModel,
  Message,
} from './types/Models';
import { MessageType, ActionMessageActionType } from './types/MessageType';
import { sendFile } from './sendFile';
import { receiveFile } from './receiveFile';

async function App() {
  const keyPair = await RSA.randomKeyPair();

  const nameCharacterSet = 'CEFGHJKMNPQRTVWXY';
  const DROP_WS_SERVER = process.env.DROP_WS_SERVER || 'wss://drop.lol/ws/';
  const DROP_ADDRESS = process.env.DROP_ADDRESS || 'https://drop.lol/';

  console.log(
    colors.yellow(
      colors.bold('drop.lol CLI - GitHub: https://github.com/mat-sz/droplol')
    )
  );
  console.log(
    colors.bold(
      'By using droplol you agree to the following Terms of Service: ' +
        colors.bold(DROP_ADDRESS + 'tos')
    )
  );
  console.log('');

  const optionDefinitions = [
    { name: 'file', type: String, defaultOption: true },
    { name: 'name', alias: 'n', type: String },
    { name: 'help', alias: 'h', type: Boolean },
  ];
  const options = commandLineArgs(optionDefinitions);

  if (options.help) {
    console.log('Usage: npx droplol [file] [-n network]');
    console.log('  --help, -h     prints help');
    console.log('  --network, -n  sets network name');
    console.log(
      'When file is provided, the file is sent and then the program exits.'
    );
    console.log(
      'When no file is provided, the program will receive all files and'
    );
    console.log('save them in the current directory.');
    process.exit(0);
  }

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
    console.log('No file selected, receive mode is enabled.');
    receiveMode = true;
  }

  // Receive
  let transferMessages: { [k: string]: TransferMessageModel } = {};

  let clientId: string;
  let connections: { [k: string]: RTCPeerConnection } = {};
  let rtcConfiguration: RTCConfiguration;

  const socket = new TypeSocket<Message>(DROP_WS_SERVER, {
    maxRetries: 0,
    retryOnClose: false,
  });

  async function handleMessage(msg: Message) {
    switch (msg.type) {
      case MessageType.WELCOME:
        clientId = msg.clientId;
        rtcConfiguration = msg.rtcConfiguration || {};
        networkName =
          options.name ||
          msg.suggestedName ||
          new Array(5)
            .fill('')
            .map(() =>
              nameCharacterSet.charAt(
                Math.floor(Math.random() * nameCharacterSet.length)
              )
            )
            .join('');

        socket.send({
          type: 'name',
          networkName: networkName,
          publicKey: keyPair.publicKey,
        } as NameMessageModel);

        if (msg.noticeText) {
          console.log('');
          console.log(colors.bold('[Notice] ') + msg.noticeText);
        }

        if (msg.noticeUrl) {
          console.log(colors.bold('[Notice] ') + 'Read more: ' + msg.noticeUrl);
        }

        console.log('');

        if (receiveMode) {
          console.log(
            colors.bold('[Network] ') +
              'Send files via: ' +
              DROP_ADDRESS +
              networkName
          );
        }
        break;
      case MessageType.NETWORK:
        console.log(
          colors.bold('[Network] ') +
            'Connected clients: ' +
            (msg.clients.length - 1)
        );
        if (msg.clients.length > 1 && fileName && fileBuffer) {
          const clients = msg.clients.filter(
            client => client.clientId !== clientId
          );
          if (!transferInProgress) {
            clients.forEach(async client => {
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
                fileType:
                  (await fromBuffer(fileBuffer))?.mime ||
                  'application/octet-stream',
              } as TransferMessageModel);

              cancellationMessages.push({
                type: MessageType.ACTION,
                transferId: transferId,
                targetId: client.clientId,
                action: ActionMessageActionType.CANCEL,
              });
            });
          }
        }
        break;
      case MessageType.TRANSFER:
        if (!receiveMode) {
          console.log(
            'Transfer request received but application is running in send mode.'
          );
          socket.send({
            type: MessageType.ACTION,
            targetId: msg.clientId as string,
            transferId: msg.transferId,
            action: ActionMessageActionType.CANCEL,
          } as ActionMessageModel);
          break;
        }

        transferMessages[msg.transferId] = msg;
        socket.send({
          type: MessageType.ACTION,
          targetId: msg.clientId as string,
          transferId: msg.transferId,
          action: ActionMessageActionType.ACCEPT,
        } as ActionMessageModel);
        break;
      case MessageType.ACTION:
        switch (msg.action) {
          case ActionMessageActionType.ACCEPT:
            if (validTransferIds.includes(msg.transferId)) {
              transferInProgress = true;
              sendFile(
                msg.transferId,
                msg.clientId as string,
                fileBuffer,
                socket.send,
                rtcConfiguration,
                connections,
                cancellationMessages
              );
            }
            break;
          case ActionMessageActionType.REJECT:
            validTransferIds = validTransferIds.filter(
              transferId => transferId !== msg.transferId
            );
            break;
        }
        break;
      case MessageType.RTC_DESCRIPTION:
        if (msg.transferId in connections) {
          connections[msg.transferId].setRemoteDescription(msg.data);
        } else if (msg.transferId in transferMessages) {
          receiveFile(
            transferMessages[msg.transferId],
            socket.send,
            rtcConfiguration,
            connections,
            msg
          );
        }
        break;
      case MessageType.RTC_CANDIDATE:
        try {
          if (msg.transferId in connections) {
            await connections[msg.transferId].addIceCandidate(msg.data);
          }
        } catch {}
        break;
      case MessageType.PING:
        socket.send({
          type: MessageType.PING,
          timestamp: new Date().getTime(),
        } as PingMessageModel);
        break;
      case MessageType.CHAT:
        console.log(colors.bold('[Chat] ') + msg.message);
        break;
    }
  }

  socket.on('message', async msg => {
    if (msg.type === MessageType.ENCRYPTED) {
      const data = await RSA.decryptString(keyPair.privateKey, msg.payload);

      if (data) {
        const json = JSON.parse(data);

        if (json && json.type) {
          if (msg.clientId) {
            json.clientId = msg.clientId;
          }

          handleMessage(json);
        }
      }
    } else {
      handleMessage(msg);
    }
  });

  socket.connect();
}

App();

import { TransferState } from './TransferState';
import { MessageType, ActionMessageActionType } from './MessageType';

export interface ActionModel {
  type: string;
  value: any;
}

export interface MessageModel {
  type: MessageType;
}

export interface WelcomeMessageModel extends MessageModel {
  type: MessageType.WELCOME;
  clientId: string;
  suggestedClientName?: string;
  suggestedNetworkName?: string;
  localNetworkNames: string[];
  rtcConfiguration?: RTCConfiguration;
  noticeText?: string;
  noticeUrl?: string;
}

export interface LocalNetworksMessageModel extends MessageModel {
  type: MessageType.LOCAL_NETWORKS;
  localNetworkNames: string[];
}

export interface NetworkNameMessageModel extends MessageModel {
  type: MessageType.NETWORK_NAME;
  networkName: string;
  publicKey?: string;
}

export interface ClientNameMessageModel extends MessageModel {
  type: MessageType.CLIENT_NAME;
  clientName: string;
}

export interface TransferMessageModel extends MessageModel {
  type: MessageType.TRANSFER;
  transferId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  targetId: string;
  clientId?: string;
}

export interface ActionMessageModel extends MessageModel {
  type: MessageType.ACTION;
  transferId: string;
  action: ActionMessageActionType;
  targetId: string;
  clientId?: string;
}

export interface NetworkMessageModel extends MessageModel {
  type: MessageType.NETWORK;
  clients: ClientModel[];
}

export interface PingMessageModel extends MessageModel {
  type: MessageType.PING;
  timestamp: number;
}

export interface RTCDescriptionMessageModel extends MessageModel {
  type: MessageType.RTC_DESCRIPTION;
  data: any;
  targetId: string;
  transferId: string;
  clientId?: string;
}

export interface RTCCandidateMessageModel extends MessageModel {
  type: MessageType.RTC_CANDIDATE;
  data: any;
  targetId: string;
  transferId: string;
  clientId?: string;
}

export interface EncryptedMessageModel extends MessageModel {
  type: MessageType.ENCRYPTED;
  targetId: string;
  payload: string;
  clientId?: string;
}

export interface TransferModel {
  transferId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  receiving: boolean;
  file?: File;
  blobUrl?: string;
  clientId?: string;
  peerConnection?: RTCPeerConnection;
  progress?: number;
  speed?: number;
  time?: number;
  state: TransferState;
}

export interface TransferUpdateModel {
  transferId: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  receiving?: boolean;
  file?: File;
  blobUrl?: string;
  clientId?: string;
  peerConnection?: RTCPeerConnection;
  progress?: number;
  speed?: number;
  time?: number;
  state?: TransferState;
}

export interface ChatMessageModel extends MessageModel {
  type: MessageType.CHAT;
  clientId?: string;
  targetId: string;
  message: string;
}

export type Message =
  | WelcomeMessageModel
  | LocalNetworksMessageModel
  | NetworkNameMessageModel
  | ClientNameMessageModel
  | TransferMessageModel
  | ActionMessageModel
  | NetworkMessageModel
  | PingMessageModel
  | RTCDescriptionMessageModel
  | RTCCandidateMessageModel
  | EncryptedMessageModel
  | ChatMessageModel;

export interface ClientModel {
  clientId: string;
  clientName?: string;
  publicKey?: string;
}

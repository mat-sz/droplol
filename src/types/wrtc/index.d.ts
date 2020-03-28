declare type __rtcPeerConnection = RTCPeerConnection;

declare module 'wrtc' {
  export type RTCPeerConnection = __rtcPeerConnection;
}

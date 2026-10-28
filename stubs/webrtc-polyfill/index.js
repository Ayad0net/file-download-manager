// See package.json. Undefined exports make simple-peer report WEBRTC_SUPPORT = false,
// so bittorrent-tracker skips WebRTC (wss://) trackers and uses TCP/UDP peers only.
export const RTCPeerConnection = undefined;
export const RTCSessionDescription = undefined;
export const RTCIceCandidate = undefined;
export const RTCIceTransport = undefined;
export const RTCDataChannel = undefined;
export const RTCSctpTransport = undefined;
export const RTCDtlsTransport = undefined;
export const RTCCertificate = undefined;

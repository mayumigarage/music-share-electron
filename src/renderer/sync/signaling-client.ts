/**
 * MusicShare — Signaling Client
 * Phase 6: Thin wrapper over WebSocketClient for WebRTC signaling (SDP/ICE via Socket.IO).
 */

import type { WebSocketClient } from './websocket-client.js';

export class SignalingClient {
  constructor(private wsClient: WebSocketClient) {}

  sendOffer(targetUserId: string, sdp: RTCSessionDescriptionInit): void {
    this.wsClient.sendSDPOffer(targetUserId, sdp);
  }

  sendAnswer(targetUserId: string, sdp: RTCSessionDescriptionInit): void {
    this.wsClient.sendSDPAnswer(targetUserId, sdp);
  }

  sendICECandidate(targetUserId: string, candidate: RTCIceCandidateInit): void {
    this.wsClient.sendICECandidate(targetUserId, candidate);
  }

  onOffer(callback: (fromUserId: string, sdp: RTCSessionDescriptionInit) => void): void {
    this.wsClient.onSDPOffer = callback;
  }

  onAnswer(callback: (fromUserId: string, sdp: RTCSessionDescriptionInit) => void): void {
    this.wsClient.onSDPAnswer = callback;
  }

  onICECandidate(callback: (fromUserId: string, candidate: RTCIceCandidateInit) => void): void {
    this.wsClient.onICECandidate = callback;
  }
}

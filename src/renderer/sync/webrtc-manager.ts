/**
 * MusicShare — WebRTC Manager
 * Phase 6: RTCPeerConnection management, P2P audio streaming.
 *
 * Host: captures system audio via getDisplayMedia, creates individual peer
 * connections per guest (mesh), enforces a soft guest limit of 5.
 * Guest: receives audio stream from host via ontrack → <audio> element.
 */

import type { WebSocketClient } from './websocket-client.js';

const STUN_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const MAX_GUESTS = 5;

const OFFER_RETRY_DELAY_MS = 8000;
const MAX_OFFER_RETRIES = 2;

export class WebRTCManager {
  private isHost: boolean;
  private localStream: MediaStream | null = null;

  // Host: map guest userId → RTCPeerConnection
  private guestConnections = new Map<string, RTCPeerConnection>();
  // Guest: single connection to host
  private hostConnection: RTCPeerConnection | null = null;
  private audioElement: HTMLAudioElement | null = null;

  /** Host userId used by guest to request offers */
  private hostUserId: string | null = null;
  private offerRetryCount = 0;
  private offerRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Fired when host tries to connect to a guest but MAX_GUESTS is reached */
  onGuestLimitReached: (() => void) | null = null;

  constructor(
    private wsClient: WebSocketClient,
    private myUserId: string,
    host: boolean,
    hostUserId?: string,
  ) {
    this.isHost = host;
    this.hostUserId = hostUserId ?? null;
  }

  // ── Host Lifecycle ──

  async initHost(): Promise<void> {
    if (!this.isHost) return;

    // ── Method 1: Electron desktopCapturer (preferred) ──
    // Captures the entire MusicShare window audio, which includes the
    // WebContentsView player (YouTube/Spotify/AppleMusic).
    try {
      const source = await (window as any).electronAPI.getDesktopAudioSource();
      if (source?.id) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
            },
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
              maxWidth: 1,
              maxHeight: 1,
            },
          },
        } as any);

        // Stop the dummy video track immediately; we only need audio.
        this.localStream.getVideoTracks().forEach((t) => t.stop());
        console.log('[WebRTC] Host audio capture started via desktopCapturer');
        return;
      }
    } catch (err) {
      console.warn('[WebRTC] desktopCapturer method failed, falling back:', err);
    }

    // ── Method 2: Standard getDisplayMedia (fallback) ──
    // User must manually select the MusicShare window / tab in the dialog.
    try {
      this.localStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: false,
      });
      console.log('[WebRTC] Host audio capture started via getDisplayMedia');
    } catch (err) {
      console.error('[WebRTC] Failed to capture audio:', err);
    }
  }

  async connectToGuest(guestUserId: string): Promise<void> {
    if (!this.isHost || !this.localStream) return;

    if (this.guestConnections.size >= MAX_GUESTS) {
      console.warn('[WebRTC] Guest limit reached (', MAX_GUESTS, ') — rejecting', guestUserId);
      this.onGuestLimitReached?.();
      return;
    }

    if (this.guestConnections.has(guestUserId)) {
      console.warn('[WebRTC] Already connected to guest', guestUserId);
      return;
    }

    const pc = new RTCPeerConnection(STUN_SERVERS);
    this.guestConnections.set(guestUserId, pc);

    // Cleanup on disconnect / failure
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.guestConnections.delete(guestUserId);
        console.log('[WebRTC] Guest connection closed:', guestUserId);
      }
    };

    // Add audio track
    this.localStream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, this.localStream!);
    });

    // ICE candidate handling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.wsClient.sendICECandidate(guestUserId, event.candidate.toJSON());
      }
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.wsClient.sendSDPOffer(guestUserId, offer);
  }

  disconnectGuest(guestUserId: string): void {
    if (!this.isHost) return;
    const pc = this.guestConnections.get(guestUserId);
    if (!pc) return;
    pc.close();
    this.guestConnections.delete(guestUserId);
    console.log('[WebRTC] Explicitly disconnected from guest', guestUserId);
  }

  // ── Guest Lifecycle ──

  async initGuest(): Promise<void> {
    if (this.isHost) return;
    this.requestOfferFromHost();
  }

  private requestOfferFromHost(): void {
    if (!this.hostUserId) return;

    console.log('[WebRTC] Requesting SDP offer from host', this.hostUserId);
    this.wsClient.sendRequestSDPOffer(this.hostUserId);

    // Schedule retry if offer doesn't arrive within timeout
    if (this.offerRetryTimer) {
      clearTimeout(this.offerRetryTimer);
    }
    if (this.offerRetryCount < MAX_OFFER_RETRIES) {
      this.offerRetryTimer = setTimeout(() => {
        if (!this.hostConnection || this.hostConnection.connectionState === 'failed' || this.hostConnection.connectionState === 'closed') {
          this.offerRetryCount++;
          console.warn(`[WebRTC] Offer retry ${this.offerRetryCount}/${MAX_OFFER_RETRIES}`);
          this.requestOfferFromHost();
        }
      }, OFFER_RETRY_DELAY_MS);
    }
  }

  // ── Signaling Handlers ──

  async handleSDPOffer(fromUserId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (this.isHost) {
      // Host should not receive offers (unless renegotiation)
      return;
    }

    // Clear retry timer since we received an offer
    if (this.offerRetryTimer) {
      clearTimeout(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }

    // Guest receives offer from host
    if (this.hostConnection) {
      // Renegotiation or duplicate — close existing
      this.hostConnection.close();
    }

    const pc = new RTCPeerConnection(STUN_SERVERS);
    this.hostConnection = pc;

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[WebRTC] Guest connection state:', state);
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.hostConnection = null;
        console.log('[WebRTC] Host connection closed');
        // Auto-retry on failure if we haven't exceeded retries
        if (state === 'failed' && this.offerRetryCount < MAX_OFFER_RETRIES) {
          this.offerRetryCount++;
          this.requestOfferFromHost();
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.wsClient.sendICECandidate(fromUserId, event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      this.playRemoteStream(stream);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.wsClient.sendSDPAnswer(fromUserId, answer);
  }

  async handleSDPAnswer(fromUserId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.isHost) return;

    const pc = this.guestConnections.get(fromUserId);
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async handleICECandidate(fromUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.isHost
      ? this.guestConnections.get(fromUserId)
      : this.hostConnection;

    if (!pc) return;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WebRTC] Failed to add ICE candidate:', err);
    }
  }

  // ── Audio Playback ──

  private playRemoteStream(stream: MediaStream): void {
    if (!this.audioElement) {
      this.audioElement = document.createElement('audio');
      this.audioElement.autoplay = true;
      document.body.appendChild(this.audioElement);
    }
    this.audioElement.srcObject = stream;
    this.audioElement.play().catch((err) => {
      console.error('[WebRTC] Audio play failed:', err);
    });
  }

  // ── Cleanup ──

  destroy(): void {
    if (this.offerRetryTimer) {
      clearTimeout(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }

    this.guestConnections.forEach((pc) => pc.close());
    this.guestConnections.clear();

    this.hostConnection?.close();
    this.hostConnection = null;

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement.remove();
      this.audioElement = null;
    }

    console.log('[WebRTC] Manager destroyed');
  }
}

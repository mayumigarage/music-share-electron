/**
 * MusicShare — Sync Engine
 * Phase 6: Host/guest synchronization logic, WebRTC P2P trigger, state broadcast.
 */

import type { WebSocketClient } from './websocket-client.js';
import type { PlayerProxy } from './player-proxy.js';
import type { WebRTCManager } from './webrtc-manager.js';
import { MusicServiceType, type Room, type User, type PlayerState, type Track } from '../../shared/models.js';
import type { ElectronAPI } from '../../shared/preload-api.js';

export class SyncEngine {
  private room: Room | null = null;
  private currentUser: User | null = null;
  private isHost = false;
  private mode: 'Individual' | 'HostBroadcast' = 'Individual';

  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private lastBroadcastState: PlayerState | null = null;

  private webrtcManager: WebRTCManager | null = null;

  /** Cache for Spotify → YouTube conversions so we don't search repeatedly. */
  private spotifyToYouTubeCache = new Map<string, string>();

  /** Fired when host reaches the guest connection limit (5) */
  onGuestLimitReached: (() => void) | null = null;
  /** Fired when the embedded player reports an error (e.g. YT error 153) */
  onPlayerError: ((errorDetail: string) => void) | null = null;

  private playerSignalingUnsub: (() => void) | null = null;

  constructor(
    private wsClient: WebSocketClient,
    private playerProxy: PlayerProxy,
  ) {
    this.bindPlayerMessages();
    this.bindPlayerInitializationError();
    this.bindPlayerSignaling();
    this.bindWebSocketSignaling();
  }

  setRoom(room: Room | null, user: User | null): void {
    this.room = room;
    this.currentUser = user;
    this.isHost = !!user && !!room && room.hostId === user.id;
    this.mode = room?.mode ?? 'Individual';

    this.stopBroadcast();
    this.cleanupWebRTC();

    if (this.isHost && room) {
      this.startBroadcast();
      if (this.mode === 'HostBroadcast') {
        this.startHostWebRTC();
      }
    } else if (!this.isHost && room && this.mode === 'HostBroadcast') {
      this.startGuestWebRTC();
    }
  }

  handleHostTransferred(newHostId: string): void {
    const wasHost = this.isHost;
    this.isHost = this.currentUser?.id === newHostId;

    if (wasHost && !this.isHost) {
      // Demoted to guest
      this.stopBroadcast();
      this.cleanupWebRTC();
      if (this.mode === 'HostBroadcast') {
        this.startGuestWebRTC();
      }
    } else if (!wasHost && this.isHost) {
      // Promoted to host
      this.stopBroadcast();
      this.cleanupWebRTC();
      this.startBroadcast();
      if (this.mode === 'HostBroadcast') {
        this.startHostWebRTC();
      }
    }
  }

  // ── User join/leave WebRTC hooks ──

  handleUserJoined(user: User): void {
    if (!this.isHost || this.mode !== 'HostBroadcast') return;
    if (user.id === this.currentUser?.id) return;
    if (!user.isOnline) return;

    // Phase 6.2: Delegate to player-side RTCPeerConnection
    window.electronAPI.sendPlayerSignaling({
      type: 'connect',
      targetUserId: user.id,
    });
  }

  handleUserLeft(userId: string): void {
    if (!this.isHost) return;
    // Phase 6.2: Notify player-side RTCPeerConnection
    window.electronAPI.sendPlayerSignaling({
      type: 'disconnect',
      targetUserId: userId,
    });
  }

  async handlePlayerStateUpdated(state: PlayerState): Promise<void> {
    if (this.isHost) {
      // Host also needs to load the next track after SkipTrack / TrackFinished / AddTrack(auto-start)
      const currentTrackId = this.room?.playerState.currentTrack?.id;
      const trackChanged = state.currentTrack != null && state.currentTrack.id !== currentTrackId;
      if (trackChanged && state.currentTrack) {
        const { url, service } = await this.resolvePlaybackUrl(
          state.currentTrack.url,
          state.currentTrack.service,
        );
        this.playerProxy.loadTrack(url, service);
        if (this.room) {
          this.room.playerState.currentTrack = state.currentTrack;
        }
      }

      // Sync play/pause when state changes
      if (state.isPlaying) {
        this.playerProxy.resume();
      } else {
        this.playerProxy.pause();
      }
      if (this.room) {
        this.room.playerState.isPlaying = state.isPlaying;
        this.room.playerState.positionSeconds = state.positionSeconds;
      }
      return;
    }
    await this.handleGuestPlayerState(state);
  }

  /**
   * Automatically convert Spotify URLs to YouTube equivalents when the user
   * has enabled the auto-convert preference. This allows users without
   * Spotify Premium / SDK tokens to listen in any room mode.
   */
  private async resolvePlaybackUrl(
    url: string,
    service: MusicServiceType,
  ): Promise<{ url: string; service: MusicServiceType }> {
    const autoConvertEnabled = localStorage.getItem('spotifyAutoConvert') !== 'false';
    if (!autoConvertEnabled || service !== MusicServiceType.Spotify) {
      return { url, service };
    }

    const cached = this.spotifyToYouTubeCache.get(url);
    if (cached) {
      return { url: cached, service: MusicServiceType.YouTube };
    }

    try {
      const converted = await window.electronAPI.convertSpotifyToYouTube(url);
      if (converted) {
        this.spotifyToYouTubeCache.set(url, converted);
        return { url: converted, service: MusicServiceType.YouTube };
      }
    } catch (e) {
      console.error('[SyncEngine] Failed to convert Spotify to YouTube:', e);
    }

    // Fallback: load the original Spotify URL if conversion fails
    return { url, service };
  }

  // ── Host Broadcast ──

  private startBroadcast(): void {
    if (!this.isHost || this.broadcastInterval) return;

    this.broadcastInterval = setInterval(() => {
      this.broadcastPlayerState();
    }, 1000);
  }

  /** Immediately update the cached seek position so the next broadcast reflects it. */
  updateSeekPosition(seconds: number): void {
    if (this.lastBroadcastState) {
      this.lastBroadcastState.positionSeconds = seconds;
      this.lastBroadcastState.updatedAt = Date.now();
    }
  }

  broadcastPlayerState(): void {
    if (!this.isHost || !this.room) return;

    const state: PlayerState = {
      isPlaying: false, // determined by player message if available
      positionSeconds: 0,
      currentTrack: this.room.playerState.currentTrack,
      updatedAt: Date.now(),
    };

    // Try to get current state from proxy (async not possible here, use cached)
    if (this.lastBroadcastState) {
      state.isPlaying = this.lastBroadcastState.isPlaying;
      state.positionSeconds = this.lastBroadcastState.positionSeconds;
      state.currentTrack = this.lastBroadcastState.currentTrack;
    }

    state.updatedAt = Date.now();
    this.wsClient.updatePlayerState(state);
  }

  private stopBroadcast(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  // ── Guest Sync ──

  private async handleGuestPlayerState(state: PlayerState): Promise<void> {
    if (this.isHost) return;

    // Load track if changed
    const currentTrackId = this.room?.playerState.currentTrack?.id;
    if (state.currentTrack && state.currentTrack.id !== currentTrackId) {
      const { url, service } = await this.resolvePlaybackUrl(
        state.currentTrack.url,
        state.currentTrack.service,
      );
      this.playerProxy.loadTrack(url, service);
      this.room && (this.room.playerState.currentTrack = state.currentTrack);
    }

    // Play / pause
    if (state.isPlaying) {
      this.playerProxy.resume();
    } else {
      this.playerProxy.pause();
    }

    // Seek only if drift > 2 seconds (micro-seek prevention)
    if (state.positionSeconds !== undefined) {
      const drift = Math.abs(state.positionSeconds - (this.room?.playerState.positionSeconds ?? 0));
      if (drift > 2) {
        this.playerProxy.seek(state.positionSeconds);
      }
    }

    // Update local room state
    if (this.room) {
      this.room.playerState = state;
    }
  }

  // ── WebRTC P2P ──

  private async startHostWebRTC(): Promise<void> {
    if (!this.room || !this.currentUser) return;

    // Phase 6.2: Enable host mode inside the player WebContentsView.
    // The player itself captures its audio via getDisplayMedia and manages
    // RTCPeerConnections so ONLY player audio is streamed (not system audio).
    window.electronAPI.sendPlayerSignaling({ type: 'set-host-mode', enabled: true });

    // Auto-connect to existing guests via player-side RTCPeerConnection
    const guests = this.room.users.filter((u) => u.id !== this.currentUser!.id && u.isOnline);
    for (const guest of guests) {
      window.electronAPI.sendPlayerSignaling({
        type: 'connect',
        targetUserId: guest.id,
      });
    }

    // Phase 6.2 note: Host audio capture now lives inside the player WebContentsView
    // via getDisplayMedia so ONLY player audio is streamed.  The legacy WebRTCManager
    // host path (desktopCapturer / getDisplayMedia from the main renderer) is no
    // longer used because it captured system-wide audio.
  }

  private async startGuestWebRTC(): Promise<void> {
    if (!this.room || !this.currentUser) return;

    const { WebRTCManager } = await import('./webrtc-manager');
    this.webrtcManager = new WebRTCManager(this.wsClient, this.currentUser.id, false, this.room.hostId);
    await this.webrtcManager.initGuest();
  }

  private cleanupWebRTC(): void {
    // Phase 6.2: Disable host mode in player WebContentsView
    window.electronAPI.sendPlayerSignaling({ type: 'set-host-mode', enabled: false });
    this.webrtcManager?.destroy();
    this.webrtcManager = null;
  }

  // ── Player Initialization Error Binding ──

  private bindPlayerInitializationError(): void {
    this.playerProxy.onInitializationError((detail) => {
      console.error('[SyncEngine] Spotify player failed to initialize:', detail);
      // Surface the raw SDK error so it is visible even if onPlayerError
      // is swallowed by higher-level debouncing / skip logic.
    });
  }

  // ── Player Message Binding ──

  private bindPlayerMessages(): void {
    this.playerProxy.onMessage((msg) => {
      switch (msg.type) {
        case 'playing':
        case 'paused':
        case 'state': {
          const isPlaying = msg.type === 'playing' || (msg.type === 'state' && msg.isPlaying);
          const position = msg.type === 'state' ? msg.currentTime : (this.lastBroadcastState?.positionSeconds ?? 0);
          const duration = msg.type === 'state' ? msg.duration : (this.lastBroadcastState?.currentTrack?.durationSeconds ?? null);

          let currentTrack = this.room?.playerState.currentTrack ?? null;

          // If the player sent track metadata (e.g. Spotify SDK), merge it into the current track
          // only when the reported track looks like the one we expect. This prevents Spotify
          // autoplay / device switching from overwriting our queue state with a random track.
          if (msg.type === 'state' && msg.trackInfo && currentTrack) {
            const reportedTitle = (msg.trackInfo.title || '').toLowerCase().trim();
            const expectedTitle = (currentTrack.title || '').toLowerCase().trim();
            const looksRelated =
              reportedTitle === expectedTitle ||
              reportedTitle.includes(expectedTitle) ||
              expectedTitle.includes(reportedTitle);

            if (looksRelated) {
              currentTrack = {
                ...currentTrack,
                title: msg.trackInfo.title || currentTrack.title,
                artist: msg.trackInfo.artist || currentTrack.artist,
                thumbnailUrl: msg.trackInfo.thumbnailUrl || currentTrack.thumbnailUrl,
              };
            } else {
              console.warn(
                '[SyncEngine] Player reported unexpected track; ignoring merge.',
                'expected:', currentTrack.title,
                'got:', msg.trackInfo.title,
              );
            }
          }

          this.lastBroadcastState = {
            isPlaying,
            positionSeconds: position,
            currentTrack,
            updatedAt: Date.now(),
          };

          if (msg.type === 'state' && currentTrack && duration) {
            this.lastBroadcastState.currentTrack = {
              ...currentTrack,
              durationSeconds: duration,
            };
          }
          break;
        }
        case 'timeUpdate': {
          if (this.lastBroadcastState) {
            this.lastBroadcastState.positionSeconds = msg.currentTimeSeconds;
            this.lastBroadcastState.updatedAt = Date.now();
          }
          break;
        }
        case 'ended': {
          if (this.isHost && this.room?.playerState.currentTrack) {
            this.wsClient.trackFinished(this.room.playerState.currentTrack.id);
          }
          break;
        }
        case 'stopped': {
          if (this.lastBroadcastState) {
            this.lastBroadcastState.isPlaying = false;
            this.lastBroadcastState.positionSeconds = 0;
            this.lastBroadcastState.updatedAt = Date.now();
          }
          break;
        }
        case 'error': {
          console.error('[PlayerProxy] Player error:', msg.error);
          this.onPlayerError?.(String(msg.error));
          // Reset playing state on error so UI doesn't get stuck in "playing" state
          if (this.lastBroadcastState) {
            this.lastBroadcastState.isPlaying = false;
          }
          // Auto-skip to next track on playback error when host so the queue doesn't stall
          if (this.isHost && this.room?.playerState.currentTrack) {
            const trackId = this.room.playerState.currentTrack.id;
            setTimeout(() => {
              if (this.room?.playerState.currentTrack?.id === trackId) {
                this.wsClient.trackFinished(trackId);
              }
            }, 500);
          }
          break;
        }
      }
    });
  }

  // ── Player Signaling Binding (Phase 6.2) ──

  private bindPlayerSignaling(): void {
    this.playerSignalingUnsub = window.electronAPI.onPlayerSignaling((payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) return;
      const msg = payload as {
        type: string;
        targetUserId?: string;
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      };

      if (!msg.targetUserId) return;

      switch (msg.type) {
        case 'offer': {
          if (msg.sdp) {
            this.wsClient.sendSDPOffer(msg.targetUserId, msg.sdp);
          }
          break;
        }
        case 'ice': {
          if (msg.candidate) {
            this.wsClient.sendICECandidate(msg.targetUserId, msg.candidate);
          }
          break;
        }
      }
    });
  }

  // ── WebSocket Signaling Binding ──

  private bindWebSocketSignaling(): void {
    this.wsClient.onSDPOffer = (fromUserId, sdp) => {
      if (this.isHost) {
        // Host should not receive offers (only guests do).
        // If we somehow receive one, relay it to the player-side peer connection
        // in case it is handling a renegotiation.
        window.electronAPI.sendPlayerSignaling({
          type: 'offer',
          targetUserId: fromUserId,
          sdp,
        });
      } else {
        this.webrtcManager?.handleSDPOffer(fromUserId, sdp);
      }
    };

    this.wsClient.onSDPAnswer = (fromUserId, sdp) => {
      if (this.isHost) {
        // Phase 6.2: Relay guest's answer to the player-side RTCPeerConnection
        window.electronAPI.sendPlayerSignaling({
          type: 'answer',
          targetUserId: fromUserId,
          sdp,
        });
      } else {
        this.webrtcManager?.handleSDPAnswer(fromUserId, sdp);
      }
    };

    this.wsClient.onICECandidate = (fromUserId, candidate) => {
      if (this.isHost) {
        // Phase 6.2: Relay guest's ICE candidate to the player-side RTCPeerConnection
        window.electronAPI.sendPlayerSignaling({
          type: 'ice',
          targetUserId: fromUserId,
          candidate,
        });
      } else {
        this.webrtcManager?.handleICECandidate(fromUserId, candidate);
      }
    };

    this.wsClient.onRequestSDPOffer = (fromUserId) => {
      if (!this.isHost || this.mode !== 'HostBroadcast') return;

      // Guest explicitly requested an offer (late-join recovery)
      console.log('[SyncEngine] Received RequestSDPOffer from', fromUserId, '— connecting via player preload');
      window.electronAPI.sendPlayerSignaling({
        type: 'connect',
        targetUserId: fromUserId,
      });
    };
  }
}

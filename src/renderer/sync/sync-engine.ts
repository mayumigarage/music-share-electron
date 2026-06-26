/**
 * MusicShare — Sync Engine
 * Phase 6: Host/guest synchronization logic and state broadcast.
 */

import type { WebSocketClient } from './websocket-client.js';
import type { PlayerProxy } from './player-proxy.js';
import { RoomPlayerType, type Room, type User, type PlayerState } from '../../shared/models.js';

export class SyncEngine {
  private room: Room | null = null;
  private currentUser: User | null = null;
  private isHost = false;

  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  private lastBroadcastState: PlayerState | null = null;

  /** Fired when the embedded player reports an error (e.g. YT error 153) */
  onPlayerError: ((errorDetail: string) => void) | null = null;
  /** Fired when the embedded player reports a non-fatal warning */
  onPlayerWarning: ((warningDetail: string) => void) | null = null;
  /** Fired when the host player reports its local playback state. */
  onHostPlayerStateObserved: ((state: PlayerState) => void) | null = null;

  private lastEndedAt = 0;

  // Deduplicate rapid duplicate player-error emissions
  private lastPlayerError = '';
  private lastPlayerErrorAt = 0;

  constructor(
    private wsClient: WebSocketClient,
    private playerProxy: PlayerProxy,
  ) {
    this.bindPlayerMessages();
  }

  setRoom(room: Room | null, user: User | null): void {
    this.room = room;
    this.currentUser = user;
    this.isHost = !!user && !!room && room.hostId === user.id;
    this.playerProxy.setPlayerType(room?.playerType ?? RoomPlayerType.YouTube);

    this.stopBroadcast();

    if (this.isHost && room) {
      this.startBroadcast();
    }
  }

  handleHostTransferred(newHostId: string): void {
    const wasHost = this.isHost;
    this.isHost = this.currentUser?.id === newHostId;

    if (wasHost && !this.isHost) {
      // Demoted to guest
      this.stopBroadcast();
    } else if (!wasHost && this.isHost) {
      // Promoted to host
      this.stopBroadcast();
      this.startBroadcast();
    }
  }

  async handlePlayerStateUpdated(state: PlayerState): Promise<void> {
    if (this.isHost) {
      // Host also needs to load the next track after SkipTrack / TrackFinished / AddTrack(auto-start)
      const currentTrackId = this.room?.playerState.currentTrack?.id;
      const trackChanged = state.currentTrack != null && state.currentTrack.id !== currentTrackId;
      // Apply the server's authoritative state before awaiting a player load.
      // Otherwise a load failure leaves the old, already-removed track locally
      // selected, so later controls attempt to operate on a nonexistent track.
      if (this.room) {
        this.room.playerState = state;
      }
      if (trackChanged && state.currentTrack) {
        try {
          await this.playerProxy.loadTrack(state.currentTrack);
        } catch (err) {
          console.error('[SyncEngine] Host loadTrack failed:', err);
          this.onPlayerError?.(err instanceof Error ? err.message : String(err));
          return;
        }
      }

      // Sync play/pause when state changes
      if (state.isPlaying) {
        this.playerProxy.resume();
      } else {
        this.playerProxy.pause();
      }
      return;
    }
    await this.handleGuestPlayerState(state);
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

    const roomState = this.room.playerState;
    const state: PlayerState = {
      // Commands such as stop and skip update the room synchronously, while
      // player messages arrive later. The room is therefore authoritative here.
      isPlaying: roomState.isPlaying,
      positionSeconds: 0,
      currentTrack: roomState.currentTrack,
      updatedAt: Date.now(),
    };

    // Preserve only a current position that belongs to the same active track.
    if (
      roomState.isPlaying &&
      roomState.currentTrack &&
      this.lastBroadcastState?.currentTrack?.id === roomState.currentTrack.id
    ) {
      state.positionSeconds = this.lastBroadcastState.positionSeconds;
    } else {
      state.positionSeconds = roomState.positionSeconds;
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
      try {
        await this.playerProxy.loadTrack(state.currentTrack);
      } catch (err) {
        console.error('[SyncEngine] Guest loadTrack failed:', err);
        return;
      }
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
          this.publishHostPlayerState();
          break;
        }
        case 'timeUpdate': {
          if (this.lastBroadcastState) {
            this.lastBroadcastState.positionSeconds = msg.currentTimeSeconds;
            this.lastBroadcastState.updatedAt = Date.now();
            this.publishHostPlayerState();
          }
          break;
        }
        case 'ended': {
          if (this.isHost && this.room?.playerState.currentTrack) {
            // Debounce duplicate ended events within 1.5s
            const now = Date.now();
            if (!this.lastEndedAt || now - this.lastEndedAt > 1500) {
              this.lastEndedAt = now;
              this.wsClient.trackFinished(this.room.playerState.currentTrack.id);
            }
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
        case 'warning': {
          console.warn('[PlayerProxy] Player warning:', msg.warning);
          this.onPlayerWarning?.(String(msg.warning));
          break;
        }
        case 'error': {
          const errorDetail = String(msg.error);

          // Deduplicate: ignore the same error within 2 seconds
          const now = Date.now();
          if (errorDetail === this.lastPlayerError && now - this.lastPlayerErrorAt < 2000) {
            return;
          }
          this.lastPlayerError = errorDetail;
          this.lastPlayerErrorAt = now;

          console.error('[PlayerProxy] Player error:', errorDetail);

          // Always surface the error to UI
          this.onPlayerError?.(errorDetail);

          // Reset playing state on error so UI doesn't get stuck in "playing" state
          if (this.lastBroadcastState) {
            this.lastBroadcastState.isPlaying = false;
          }

          break;
        }
      }
    });
  }

  /** Keep the host UI in sync without waiting for its own socket broadcast. */
  private publishHostPlayerState(): void {
    if (!this.isHost || !this.room || !this.lastBroadcastState) return;

    const state = this.lastBroadcastState;
    this.room.playerState = state;
    this.onHostPlayerStateObserved?.(state);
  }

}

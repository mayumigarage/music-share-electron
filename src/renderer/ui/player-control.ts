/**
 * MusicShare — Player Control (Bottom Bar)
 * Phase 6: Play/pause, stop, seek bar, volume slider.
 */

import type { PlayerProxy } from '../sync/player-proxy.js';
import type { WebSocketClient } from '../sync/websocket-client.js';
import type { SyncEngine } from '../sync/sync-engine.js';
import type { Room, User, PlayerState, Track } from '../../shared/models.js';

export class PlayerControl {
  private room: Room | null = null;
  private currentUser: User | null = null;
  private isHost = false;
  private currentDuration = 0;
  private isSeeking = false;

  private playBtn = document.getElementById('btn-play-pause') as HTMLButtonElement;
  private stopBtn = document.getElementById('btn-stop') as HTMLButtonElement;
  private prevBtn = document.getElementById('btn-prev') as HTMLButtonElement;
  private nextBtn = document.getElementById('btn-next') as HTMLButtonElement;
  private seekBar = document.getElementById('seek-bar') as HTMLInputElement;
  private timeCurrent = document.getElementById('time-current') as HTMLElement;
  private timeTotal = document.getElementById('time-total') as HTMLElement;
  private volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
  private muteBtn = document.getElementById('btn-mute') as HTMLButtonElement;

  private volumeBeforeMute = 80;

  constructor(
    private playerProxy: PlayerProxy,
    private wsClient: WebSocketClient,
    private syncEngine: SyncEngine,
  ) {}

  init(): void {
    this.playBtn.addEventListener('click', () => this.togglePlayPause());
    this.stopBtn.addEventListener('click', () => this.stop());
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());

    this.seekBar.addEventListener('input', () => {
      this.isSeeking = true;
      this.timeCurrent.textContent = this.formatTime(Number(this.seekBar.value));
    });

    this.seekBar.addEventListener('change', () => {
      this.isSeeking = false;
      const pos = Number(this.seekBar.value);
      if (this.isHost) {
        this.playerProxy.seek(pos);
        // Force the local state and cached broadcast state to the new position
        // so the next broadcast carries the correct value (not the stale one).
        if (this.room) {
          this.room.playerState.positionSeconds = pos;
        }
        this.syncEngine.updateSeekPosition(pos);
        this.syncEngine.broadcastPlayerState();
      } else {
        // Guest requesting seek — handled as play/pause request for simplicity in Phase 1
        this.playerProxy.seek(pos);
      }
    });

    this.volumeSlider.addEventListener('input', () => {
      const vol = Number(this.volumeSlider.value);
      this.playerProxy.setVolume(vol / 100);
      this.muteBtn.textContent = vol === 0 ? '🔇' : vol < 50 ? '🔉' : '🔊';
    });

    this.muteBtn.addEventListener('click', () => {
      const current = Number(this.volumeSlider.value);
      if (current > 0) {
        this.volumeBeforeMute = current;
        this.volumeSlider.value = '0';
        this.playerProxy.setVolume(0);
        this.muteBtn.textContent = '🔇';
      } else {
        this.volumeSlider.value = String(this.volumeBeforeMute);
        this.playerProxy.setVolume(this.volumeBeforeMute / 100);
        this.muteBtn.textContent = this.volumeBeforeMute < 50 ? '🔉' : '🔊';
      }
    });
  }

  setRoom(room: Room | null, user: User | null): void {
    this.room = room;
    this.currentUser = user;
    this.isHost = !!user && !!room && room.hostId === user.id;

    if (room) {
      this.updateState(room.playerState);
    } else {
      this.resetUI();
    }
  }

  updateState(state: PlayerState): void {
    if (!this.isSeeking) {
      this.seekBar.value = String(Math.floor(state.positionSeconds));
      this.timeCurrent.textContent = this.formatTime(state.positionSeconds);
    }

    if (state.currentTrack) {
      const dur = state.currentTrack.durationSeconds ?? 0;
      this.currentDuration = dur;
      this.seekBar.max = String(dur || 100);
      this.timeTotal.textContent = this.formatTime(dur);
      this.playBtn.textContent = state.isPlaying ? '⏸️' : '▶️';
    } else {
      this.resetUI();
    }
  }

  togglePlayPause(): void {
    if (!this.room || !this.currentUser) return;

    if (this.isHost) {
      // If nothing is loaded but queue has tracks, start the first one
      if (!this.room.playerState.currentTrack && this.room.queue.length > 0) {
        const nextTrack = this.room.queue[0];
        this.playerProxy.loadTrack(nextTrack.url, nextTrack.service);
        // Note: playTrack/loadVideoById already start playback; do NOT call resume() here
        this.room.playerState.currentTrack = nextTrack;
        this.room.playerState.isPlaying = true;
        this.room.playerState.positionSeconds = 0;
        this.syncEngine.broadcastPlayerState();
        return;
      }

      const shouldPlay = !this.room.playerState.isPlaying;
      if (shouldPlay) {
        this.playerProxy.resume();
      } else {
        this.playerProxy.pause();
      }
      this.room.playerState.isPlaying = shouldPlay;
      this.syncEngine.broadcastPlayerState();
    } else {
      this.wsClient.requestPlayPause();
    }
  }

  stop(): void {
    if (!this.room || !this.currentUser) return;
    if (this.isHost) {
      this.playerProxy.stop();
      this.room.playerState.isPlaying = false;
      this.room.playerState.positionSeconds = 0;
      this.room.playerState.currentTrack = null;
      this.syncEngine.updateSeekPosition(0);
      this.syncEngine.broadcastPlayerState();
    } else {
      this.wsClient.requestStop();
    }
  }

  prev(): void {
    // Phase 1: no-op / placeholder
  }

  next(): void {
    if (!this.room || !this.isHost) return;
    const currentTrackId = this.room.playerState.currentTrack?.id;
    if (currentTrackId) {
      this.wsClient.skipTrack(currentTrackId);
    } else if (this.room.queue.length > 0) {
      // If nothing is currently playing (e.g. after stop), start the first queued track
      const nextTrack = this.room.queue[0];
      this.playerProxy.loadTrack(nextTrack.url, nextTrack.service);
      this.room.playerState.currentTrack = nextTrack;
      this.room.playerState.isPlaying = true;
      this.room.playerState.positionSeconds = 0;
      this.syncEngine.broadcastPlayerState();
    }
  }

  private resetUI(): void {
    this.seekBar.value = '0';
    this.seekBar.max = '100';
    this.timeCurrent.textContent = '0:00';
    this.timeTotal.textContent = '0:00';
    this.playBtn.textContent = '▶️';
  }

  private formatTime(seconds: number): string {
    if (!seconds || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}

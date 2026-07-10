/**
 * MusicShare — Player Control (Bottom Bar)
 * Phase 6: Play/pause, seek bar, volume slider.
 */

import type { PlayerProxy } from '../sync/player-proxy.js';
import type { WebSocketClient } from '../sync/websocket-client.js';
import type { SyncEngine } from '../sync/sync-engine.js';
import { MusicServiceType, RoomPlayerType, type Room, type User, type PlayerState, type Track } from '../../shared/models.js';
import type { PlayerMessage } from '../../shared/preload-api.js';
import { setIconButton } from './icons.js';

export class PlayerControl {
  private room: Room | null = null;
  private currentUser: User | null = null;
  private isHost = false;
  private currentDuration = 0;
  private isSeeking = false;
  private localTracks: Track[] = [];
  private localTrackIndex = -1;
  private localState: PlayerState | null = null;
  private isLocalPlayback = false;
  private lastLocalEndedAt = 0;
  private localPlaylistPlayerType = RoomPlayerType.YouTube;

  private playBtn = document.getElementById('btn-play-pause') as HTMLButtonElement;
  private prevBtn = document.getElementById('btn-prev') as HTMLButtonElement;
  private nextBtn = document.getElementById('btn-next') as HTMLButtonElement;
  private seekBar = document.getElementById('seek-bar') as HTMLInputElement;
  private timeCurrent = document.getElementById('time-current') as HTMLElement;
  private timeTotal = document.getElementById('time-total') as HTMLElement;
  private volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
  private muteBtn = document.getElementById('btn-mute') as HTMLButtonElement;
  private miniPlayer = document.getElementById('playlist-mini-player') as HTMLElement | null;
  private miniThumb = document.getElementById('playlist-mini-thumb') as HTMLImageElement | null;
  private miniTitle = document.getElementById('playlist-mini-title') as HTMLElement | null;
  private miniArtist = document.getElementById('playlist-mini-artist') as HTMLElement | null;
  private miniPlayBtn = document.getElementById('btn-playlist-mini-play') as HTMLButtonElement | null;
  private miniPrevBtn = document.getElementById('btn-playlist-mini-prev') as HTMLButtonElement | null;
  private miniNextBtn = document.getElementById('btn-playlist-mini-next') as HTMLButtonElement | null;
  private miniCloseBtn = document.getElementById('btn-playlist-mini-close') as HTMLButtonElement | null;

  private volumeBeforeMute = 80;

  onLocalPlayerStateUpdated: ((state: PlayerState) => void) | null = null;

  constructor(
    private playerProxy: PlayerProxy,
    private wsClient: WebSocketClient,
    private syncEngine: SyncEngine,
    private localPlayerProxy: PlayerProxy = playerProxy,
  ) {}

  init(): void {
    this.playBtn.addEventListener('click', () => this.togglePlayPause());
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());
    this.miniPlayBtn?.addEventListener('click', () => this.toggleLocalPlayPause());
    this.miniPrevBtn?.addEventListener('click', () => this.prevLocal());
    this.miniNextBtn?.addEventListener('click', () => {
      void this.playNextLocalTrack();
    });
    this.miniCloseBtn?.addEventListener('click', () => this.stopLocalPlayback());

    this.seekBar.addEventListener('input', () => {
      this.isSeeking = true;
      this.timeCurrent.textContent = this.formatTime(Number(this.seekBar.value));
    });

    this.seekBar.addEventListener('change', () => {
      this.isSeeking = false;
      const pos = Number(this.seekBar.value);
      if (this.isLocalPlayback && this.localState) {
        this.localPlayerProxy.seek(pos);
        this.localState.positionSeconds = pos;
        this.localState.updatedAt = Date.now();
        this.publishLocalState();
        return;
      }
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
      this.getActiveControlPlayer().setVolume(vol / 100);
      setIconButton(this.muteBtn, vol === 0 ? 'speaker-x-mark' : 'speaker-wave', vol === 0 ? 'ミュート解除' : 'ミュート', { size: 20 });
    });

    this.muteBtn.addEventListener('click', () => {
      const current = Number(this.volumeSlider.value);
      if (current > 0) {
        this.volumeBeforeMute = current;
        this.volumeSlider.value = '0';
        this.getActiveControlPlayer().setVolume(0);
        setIconButton(this.muteBtn, 'speaker-x-mark', 'ミュート解除', { size: 20 });
      } else {
        this.volumeSlider.value = String(this.volumeBeforeMute);
        this.getActiveControlPlayer().setVolume(this.volumeBeforeMute / 100);
        setIconButton(this.muteBtn, 'speaker-wave', 'ミュート', { size: 20 });
      }
    });

    this.localPlayerProxy.onMessage((message) => this.handleLocalPlayerMessage(message));
  }

  setRoom(room: Room | null, user: User | null): void {
    this.room = room;
    this.currentUser = user;
    this.isHost = !!user && !!room && room.hostId === user.id;

    if (this.isLocalPlayback && this.localState) {
      this.publishLocalState();
    } else if (room) {
      this.updateState(room.playerState);
    } else {
      this.resetUI();
    }
  }

  isLocalPlaybackActive(): boolean {
    return this.isLocalPlayback;
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
      setIconButton(this.playBtn, state.isPlaying ? 'pause-solid' : 'play-solid', state.isPlaying ? '一時停止' : '再生', { size: 20 });
    } else {
      this.resetUI();
    }
  }

  togglePlayPause(): void {
    if (this.isLocalPlayback && !this.room) {
      this.toggleLocalPlayPause();
      return;
    }
    if (!this.room || !this.currentUser) return;

    if (this.isHost) {
      // If nothing is loaded but queue has tracks, start the first one
      if (!this.room.playerState.currentTrack && this.room.queue.length > 0) {
        const nextTrack = this.room.queue[0];
        void this.startTrack(nextTrack);
        return;
      }

      const shouldPlay = !this.room.playerState.isPlaying;
      if (shouldPlay) {
        this.playerProxy.resume();
      } else {
        this.playerProxy.pause();
      }
      this.room.playerState.isPlaying = shouldPlay;
      this.updateState(this.room.playerState);
      this.syncEngine.broadcastPlayerState();
    } else {
      this.wsClient.requestPlayPause();
    }
  }

  prev(): void {
    if (!this.isLocalPlayback || this.room) return;
    this.prevLocal();
  }

  private prevLocal(): void {
    if (this.localTrackIndex > 0) {
      void this.startLocalTrack(this.localTrackIndex - 1);
      return;
    }
    if (this.localState) {
      this.localPlayerProxy.seek(0);
      this.localState.positionSeconds = 0;
      this.publishLocalState();
    }
  }

  next(): void {
    if (this.isLocalPlayback && !this.room) {
      void this.playNextLocalTrack();
      return;
    }
    if (!this.room || !this.isHost) return;
    const currentTrackId = this.room.playerState.currentTrack?.id;
    if (currentTrackId) {
      this.playerProxy.stop();
      this.room.playerState.currentTrack = null;
      this.room.playerState.isPlaying = false;
      this.room.playerState.positionSeconds = 0;
      this.updateState(this.room.playerState);
      this.syncEngine.broadcastPlayerState();
      this.wsClient.skipTrack(currentTrackId);
    } else if (this.room.queue.length > 0) {
      // If nothing is currently playing (e.g. after stop), start the first queued track
      const nextTrack = this.room.queue[0];
      void this.startTrack(nextTrack);
    }
  }

  setLocalPlaylistPlayerType(playerType: RoomPlayerType): void {
    this.localPlaylistPlayerType = playerType;
  }

  async playLocalPlaylist(tracks: Track[], startIndex = 0, playerType = this.localPlaylistPlayerType): Promise<void> {
    if (tracks.length === 0) return;

    this.localPlaylistPlayerType = playerType;
    this.localTracks = tracks.map((track) => ({ ...track }));
    this.localTrackIndex = Math.min(Math.max(startIndex, 0), this.localTracks.length - 1);
    this.isLocalPlayback = true;
    this.setLocalPlayerVisible(true);
    await this.startLocalTrack(this.localTrackIndex);
  }

  /** Start an explicitly selected queued track without leaving stale local state if loading fails. */
  private async startTrack(track: Track): Promise<void> {
    try {
      await this.playerProxy.loadTrack(track);
    } catch (error) {
      console.error('[PlayerControl] Failed to load track:', error);
      this.playerProxy.stop();
      if (this.room?.queue.some((queuedTrack) => queuedTrack.id === track.id)) {
        this.wsClient.trackFinished(track.id);
      }
      return;
    }

    if (!this.room || this.room.queue.every((queuedTrack) => queuedTrack.id !== track.id)) return;
    this.playerProxy.resume();
    this.room.playerState.currentTrack = track;
    this.room.playerState.isPlaying = true;
    this.room.playerState.positionSeconds = 0;
    this.updateState(this.room.playerState);
    this.syncEngine.broadcastPlayerState();
  }

  private resetUI(): void {
    this.seekBar.value = '0';
    this.seekBar.max = '100';
    this.timeCurrent.textContent = '0:00';
    this.timeTotal.textContent = '0:00';
    setIconButton(this.playBtn, 'play-solid', '再生', { size: 20 });
  }

  private async startLocalTrack(index: number): Promise<void> {
    const track = this.localTracks[index];
    if (!track) {
      this.stopLocalPlayback();
      return;
    }

    this.localTrackIndex = index;
    this.localPlayerProxy.setPlayerType(this.getLocalPlayerType(track));
    this.localPlayerProxy.setVolume(Number(this.volumeSlider.value) / 100);

    try {
      await this.localPlayerProxy.loadTrack(track);
    } catch (error) {
      console.error('[PlayerControl] Failed to load local playlist track:', error);
      await this.playNextLocalTrack();
      return;
    }

    this.localPlayerProxy.resume();
    this.localPlayerProxy.preloadUpcomingTracks(this.localTracks, track.id);
    this.localState = {
      isPlaying: true,
      positionSeconds: 0,
      currentTrack: track,
      updatedAt: Date.now(),
    };
    this.publishLocalState();
  }

  private toggleLocalPlayPause(): void {
    if (!this.localState?.currentTrack) {
      void this.startLocalTrack(Math.max(this.localTrackIndex, 0));
      return;
    }

    const shouldPlay = !this.localState.isPlaying;
    if (shouldPlay) {
      this.localPlayerProxy.resume();
    } else {
      this.localPlayerProxy.pause();
    }
    this.localState.isPlaying = shouldPlay;
    this.localState.updatedAt = Date.now();
    this.publishLocalState();
  }

  private async playNextLocalTrack(): Promise<void> {
    const nextIndex = this.localTrackIndex + 1;
    if (nextIndex < this.localTracks.length) {
      await this.startLocalTrack(nextIndex);
      return;
    }
    this.stopLocalPlayback();
  }

  private stopLocalPlayback(): void {
    this.localPlayerProxy.stop();
    this.localPlayerProxy.preloadUpcomingTracks([], null);
    this.isLocalPlayback = false;
    this.localTracks = [];
    this.localTrackIndex = -1;
    this.localState = {
      isPlaying: false,
      positionSeconds: 0,
      currentTrack: null,
      updatedAt: Date.now(),
    };
    this.publishLocalState();
    this.localState = null;
    this.setLocalPlayerVisible(false);
    if (this.room) {
      this.updateState(this.room.playerState);
    }
  }

  private handleLocalPlayerMessage(message: PlayerMessage): void {
    if (!this.isLocalPlayback || !this.localState) return;

    switch (message.type) {
      case 'playing':
        this.localState.isPlaying = true;
        this.localState.updatedAt = Date.now();
        this.publishLocalState();
        break;
      case 'paused':
        this.localState.isPlaying = false;
        this.localState.updatedAt = Date.now();
        this.publishLocalState();
        break;
      case 'state': {
        const duration = Number.isFinite(message.duration) ? message.duration : this.localState.currentTrack?.durationSeconds ?? null;
        this.localState = {
          isPlaying: message.isPlaying,
          positionSeconds: message.currentTime,
          currentTrack: this.localState.currentTrack
            ? { ...this.localState.currentTrack, durationSeconds: duration }
            : null,
          updatedAt: Date.now(),
        };
        this.publishLocalState();
        break;
      }
      case 'timeUpdate':
        this.localState.positionSeconds = message.currentTimeSeconds;
        this.localState.updatedAt = Date.now();
        this.publishLocalState();
        break;
      case 'ended': {
        const now = Date.now();
        if (!this.lastLocalEndedAt || now - this.lastLocalEndedAt > 1500) {
          this.lastLocalEndedAt = now;
          void this.playNextLocalTrack();
        }
        break;
      }
      case 'stopped':
        this.localState.isPlaying = false;
        this.localState.positionSeconds = 0;
        this.localState.updatedAt = Date.now();
        this.publishLocalState();
        break;
      default:
        break;
    }
  }

  private publishLocalState(): void {
    if (!this.localState) return;
    this.updateMiniPlayer(this.localState);
    if (!this.room) {
      this.updateState(this.localState);
    }
    this.onLocalPlayerStateUpdated?.(this.localState);
  }

  private getActiveControlPlayer(): PlayerProxy {
    return this.isLocalPlayback && !this.room ? this.localPlayerProxy : this.playerProxy;
  }

  private setLocalPlayerVisible(isVisible: boolean): void {
    if (this.localPlayerProxy === this.playerProxy) return;
    this.localPlayerProxy.setVisible(isVisible);
    this.miniPlayer?.classList.toggle('open', isVisible);
    if (!this.room) {
      this.playerProxy.setVisible(!isVisible);
    } else {
      this.playerProxy.setVisible(true);
    }
  }

  private updateMiniPlayer(state: PlayerState): void {
    const track = state.currentTrack;
    if (!track) {
      this.miniPlayer?.classList.remove('open');
      if (this.miniPlayBtn) {
        setIconButton(this.miniPlayBtn, 'play-solid', '再生', { size: 20 });
      }
      return;
    }

    this.miniPlayer?.classList.add('open');
    if (this.miniThumb) {
      if (track.thumbnailUrl) {
        this.miniThumb.src = track.thumbnailUrl;
        this.miniThumb.style.display = 'block';
      } else {
        this.miniThumb.style.display = 'none';
      }
    }
    if (this.miniTitle) this.miniTitle.textContent = track.title;
    if (this.miniArtist) this.miniArtist.textContent = track.artist;
    if (this.miniPlayBtn) {
      setIconButton(this.miniPlayBtn, state.isPlaying ? 'pause-solid' : 'play-solid', state.isPlaying ? '一時停止' : '再生', { size: 20 });
    }
  }

  private getLocalPlayerType(track: Track): RoomPlayerType {
    if (track.service === MusicServiceType.DirectVideo || track.service === MusicServiceType.LocalAudio) {
      return RoomPlayerType.HtmlVideo;
    }
    return this.localPlaylistPlayerType;
  }

  private formatTime(seconds: number): string {
    if (!seconds || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}

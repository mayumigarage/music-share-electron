/**
 * HTMLVideoElement adapter for rooms that play direct media URLs.
 */
import type { Track } from '../../shared/models.js';
import type { PlayerMessage } from '../../shared/preload-api.js';

type MessageListener = (message: PlayerMessage) => void;

export class DomVideoPlayer {
  private video: HTMLVideoElement;
  private listeners = new Set<MessageListener>();
  private reportInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const existing = document.getElementById('html-video-player');
    if (existing instanceof HTMLVideoElement) {
      this.video = existing;
    } else {
      this.video = document.createElement('video');
      this.video.id = 'html-video-player';
      this.video.controls = true;
      this.video.playsInline = true;
      this.video.preload = 'metadata';
      document.getElementById('player-container')?.appendChild(this.video);
    }

    this.bindVideoEvents();
    this.emit({ type: 'ready' });
  }

  setVisible(isVisible: boolean): void {
    this.video.style.display = isVisible ? 'block' : 'none';
    if (!isVisible) {
      this.pause();
      this.stopReporting();
    }
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  loadTrack(track: Track): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!track.url) {
        reject(new Error('動画URLが空です'));
        return;
      }

      const cleanup = () => {
        this.video.removeEventListener('loadedmetadata', handleLoaded);
        this.video.removeEventListener('error', handleError);
      };
      const handleLoaded = () => {
        cleanup();
        this.emit({ type: 'loaded', uri: track.url });
        this.emitState();
        resolve();
      };
      const handleError = () => {
        cleanup();
        const error = this.video.error;
        reject(new Error(error ? `HTML video error: ${error.code}` : 'HTML video error'));
      };

      this.stopReporting();
      this.video.addEventListener('loadedmetadata', handleLoaded);
      this.video.addEventListener('error', handleError);
      this.video.src = track.url;
      this.video.load();
    });
  }

  play(): void {
    void this.video.play().catch((error: unknown) => {
      this.emit({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    });
  }

  pause(): void { this.video.pause(); }

  stop(): void {
    this.video.pause();
    if (Number.isFinite(this.video.duration)) {
      this.video.currentTime = 0;
    }
    this.emit({ type: 'stopped' });
  }

  seek(seconds: number): void {
    if (Number.isFinite(seconds)) {
      this.video.currentTime = Math.max(0, seconds);
      this.emitState();
    }
  }

  setVolume(volume: number): void {
    this.video.volume = Math.max(0, Math.min(1, volume));
  }

  private bindVideoEvents(): void {
    this.video.addEventListener('playing', () => {
      this.emit({ type: 'playing' });
      this.startReporting();
    });
    this.video.addEventListener('pause', () => {
      this.emit({ type: 'paused' });
      this.stopReporting();
      this.emitState();
    });
    this.video.addEventListener('ended', () => {
      this.emit({ type: 'ended' });
      this.stopReporting();
    });
    this.video.addEventListener('error', () => {
      const error = this.video.error;
      this.emit({ type: 'error', error: error ? `HTML video error: ${error.code}` : 'HTML video error' });
    });
    this.video.addEventListener('durationchange', () => {
      if (Number.isFinite(this.video.duration)) {
        this.emit({ type: 'duration', durationSeconds: this.video.duration });
      }
    });
  }

  private startReporting(): void {
    this.stopReporting();
    this.reportInterval = setInterval(() => this.emitState(), 1000);
  }

  private stopReporting(): void {
    if (this.reportInterval) clearInterval(this.reportInterval);
    this.reportInterval = null;
  }

  private emitState(): void {
    const currentTime = this.video.currentTime || 0;
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    this.emit({ type: 'timeUpdate', currentTimeSeconds: currentTime });
    this.emit({
      type: 'state',
      isPlaying: !this.video.paused && !this.video.ended,
      currentTime,
      duration,
    });
  }

  private emit(message: PlayerMessage): void {
    this.listeners.forEach((listener) => listener(message));
  }
}

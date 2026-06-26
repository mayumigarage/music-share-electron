/**
 * HTMLVideoElement adapter for rooms that play direct media URLs.
 */
import type { Track } from '../../shared/models.js';
import type { PlayerMessage } from '../../shared/preload-api.js';

type MessageListener = (message: PlayerMessage) => void;

const VIDEO_DIAGNOSTIC_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'canplaythrough',
  'playing',
  'waiting',
  'stalled',
  'suspend',
  'abort',
  'emptied',
  'ended',
  'error',
] as const;

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
      // Diagnostic note: if playback fails only for googlevideo.com URLs,
      // test with crossOrigin unset. crossOrigin="anonymous" forces a CORS
      // fetch path and can surface as MEDIA_ERR_SRC_NOT_SUPPORTED.
      document.getElementById('player-container')?.appendChild(this.video);
    }

    this.bindVideoEvents();
    this.logVideoSettings();
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
      console.log(`[DomVideoPlayer][before-video-src] ${JSON.stringify({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        service: track.service,
        resolvedVideoId: track.resolvedVideoId,
        url: this.maskUrlForLog(track.url),
        urlLength: track.url.length,
        video: this.getVideoDiagnostics(),
      }, null, 2)}`);
      this.video.src = track.url;
      console.log(`[DomVideoPlayer][after-video-src] ${JSON.stringify({
        trackId: track.id,
        url: this.maskUrlForLog(track.url),
        urlLength: track.url.length,
        video: this.getVideoDiagnostics(),
      }, null, 2)}`);
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
    VIDEO_DIAGNOSTIC_EVENTS.forEach((eventName) => {
      this.video.addEventListener(eventName, () => this.logVideoEvent(eventName));
    });

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

  private logVideoSettings(): void {
    const videoWithReferrerPolicy = this.video as HTMLVideoElement & { referrerPolicy?: string };
    console.log(`[DomVideoPlayer][settings] ${JSON.stringify({
      crossOrigin: this.video.crossOrigin,
      referrerPolicy: videoWithReferrerPolicy.referrerPolicy ?? this.video.getAttribute('referrerpolicy'),
      preload: this.video.preload,
      autoplay: this.video.autoplay,
      muted: this.video.muted,
      controls: this.video.controls,
    }, null, 2)}`);
  }

  private logVideoEvent(eventName: string): void {
    console.log(`[DomVideoPlayer][${eventName}] ${JSON.stringify(this.getVideoDiagnostics(), null, 2)}`);
  }

  private getVideoDiagnostics(): Record<string, unknown> {
    const error = this.video.error;
    return {
      currentSrc: this.maskUrlForLog(this.video.currentSrc),
      src: this.maskUrlForLog(this.video.src),
      paused: this.video.paused,
      duration: Number.isFinite(this.video.duration) ? this.video.duration : String(this.video.duration),
      currentTime: this.video.currentTime,
      readyState: this.video.readyState,
      networkState: this.video.networkState,
      error: error ? {
        code: error.code,
        message: error.message,
      } : null,
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
      crossOrigin: this.video.crossOrigin,
      preload: this.video.preload,
      muted: this.video.muted,
      volume: this.video.volume,
    };
  }

  private maskUrlForLog(value: string): string {
    if (!value) return value;
    try {
      const parsed = new URL(value);
      for (const key of parsed.searchParams.keys()) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('sig') || lowerKey === 'lsig' || lowerKey === 'signature') {
          parsed.searchParams.set(key, '[masked]');
        }
      }
      return parsed.toString().slice(0, 200);
    } catch {
      return value.slice(0, 200);
    }
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

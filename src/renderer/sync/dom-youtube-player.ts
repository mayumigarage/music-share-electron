/**
 * YouTube IFrame Player API adapter rendered inside the main DOM.
 * Keeping it in the renderer lets normal CSS stacking place dialogs above it.
 */
import type { PlayerMessage } from '../../shared/preload-api.js';

type MessageListener = (message: PlayerMessage) => void;

interface YouTubePlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
}

declare global {
  interface Window {
    YT?: {
      Player: new (elementId: string, options: object) => YouTubePlayer;
      PlayerState: { PLAYING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export class DomYouTubePlayer {
  private player: YouTubePlayer | null = null;
  private ready = false;
  private pendingVideoId: string | null = null;
  private listeners = new Set<MessageListener>();
  private reportInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    window.onYouTubeIframeAPIReady = () => this.createPlayer();
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  loadTrack(videoId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!videoId) {
        reject(new Error('invalid YouTube video ID'));
        return;
      }
      const unsubscribe = this.onMessage((message) => {
        if (message.type === 'loaded') {
          unsubscribe();
          resolve();
        } else if (message.type === 'error') {
          unsubscribe();
          reject(new Error(message.error));
        }
      });
      if (!this.ready || !this.player) {
        this.pendingVideoId = videoId;
        return;
      }
      this.player.loadVideoById(videoId);
      this.emit({ type: 'loaded', uri: videoId });
    });
  }

  play(): void { this.player?.playVideo(); }
  pause(): void { this.player?.pauseVideo(); }
  stop(): void { this.player?.stopVideo(); this.emit({ type: 'stopped' }); }
  seek(seconds: number): void { this.player?.seekTo(seconds, true); }
  setVolume(volume: number): void { this.player?.setVolume(Math.round(volume * 100)); }

  private createPlayer(): void {
    if (!window.YT) return;
    this.player = new window.YT.Player('youtube-player', {
      width: '100%', height: '100%',
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          this.ready = true;
          this.emit({ type: 'ready' });
          if (this.pendingVideoId) {
            const videoId = this.pendingVideoId;
            this.pendingVideoId = null;
            this.player?.loadVideoById(videoId);
            this.emit({ type: 'loaded', uri: videoId });
          }
        },
        onStateChange: (event: { data: number }) => this.handleStateChange(event.data),
        onError: (event: { data: number }) => this.emit({ type: 'error', error: `YouTube player error: ${event.data}` }),
      },
    });
  }

  private handleStateChange(state: number): void {
    const playerState = window.YT?.PlayerState;
    if (!playerState) return;
    if (state === playerState.PLAYING) {
      this.emit({ type: 'playing' });
      this.startReporting();
    } else {
      this.emit({ type: 'paused' });
      if (state === 0) this.emit({ type: 'ended' });
      this.stopReporting();
    }
  }

  private startReporting(): void {
    this.stopReporting();
    this.reportInterval = setInterval(() => {
      if (!this.player || !window.YT) return;
      const currentTime = this.player.getCurrentTime() || 0;
      this.emit({ type: 'timeUpdate', currentTimeSeconds: currentTime });
      this.emit({
        type: 'state',
        isPlaying: this.player.getPlayerState() === window.YT.PlayerState.PLAYING,
        currentTime,
        duration: this.player.getDuration() || 0,
      });
    }, 1000);
  }

  private stopReporting(): void {
    if (this.reportInterval) clearInterval(this.reportInterval);
    this.reportInterval = null;
  }

  private emit(message: PlayerMessage): void {
    this.listeners.forEach((listener) => listener(message));
  }
}

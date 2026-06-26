/**
 * MusicShare — Player Proxy
 * Phase 6: Abstraction layer for DOM-hosted players.
 */
import { DomYouTubePlayer } from './dom-youtube-player.js';
import { DomVideoPlayer } from './dom-video-player.js';
import { RoomPlayerType, type Track } from '../../shared/models.js';
import type { PlayerMessage } from '../../shared/preload-api.js';

export class PlayerProxy {
  private youtubePlayer = new DomYouTubePlayer();
  private videoPlayer = new DomVideoPlayer();
  private playerType = RoomPlayerType.YouTube;
  private listeners = new Set<(message: PlayerMessage) => void>();

  constructor() {
    this.youtubePlayer.onMessage((message) => {
      if (this.playerType === RoomPlayerType.YouTube) this.emit(message);
    });
    this.videoPlayer.onMessage((message) => {
      if (this.playerType === RoomPlayerType.HtmlVideo) this.emit(message);
    });
    this.setPlayerType(RoomPlayerType.YouTube);
  }

  setPlayerType(playerType: RoomPlayerType): void {
    if (this.playerType !== playerType) {
      this.stop();
    }
    this.playerType = playerType;
    const isVideo = playerType === RoomPlayerType.HtmlVideo;
    document.getElementById('youtube-player')?.style.setProperty('display', isVideo ? 'none' : 'block');
    this.videoPlayer.setVisible(isVideo);
  }

  loadTrack(track: Track): Promise<void> {
    if (this.playerType === RoomPlayerType.HtmlVideo) {
      return this.videoPlayer.loadTrack(track);
    }
    if (!track.resolvedVideoId) {
      return Promise.reject(new Error('YouTube Music の再生候補を解決できませんでした'));
    }
    return this.youtubePlayer.loadTrack(track.resolvedVideoId);
  }

  play(): void { this.activePlayer().play(); }

  pause(): void { this.activePlayer().pause(); }

  resume(): void { this.activePlayer().play(); }

  stop(): void { this.activePlayer().stop(); }

  seek(positionSeconds: number): void { this.activePlayer().seek(positionSeconds); }

  setVolume(volume: number): void { this.activePlayer().setVolume(volume); }

  onMessage(callback: (message: PlayerMessage) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private activePlayer(): DomYouTubePlayer | DomVideoPlayer {
    return this.playerType === RoomPlayerType.HtmlVideo ? this.videoPlayer : this.youtubePlayer;
  }

  private emit(message: PlayerMessage): void {
    this.listeners.forEach((listener) => listener(message));
  }
}

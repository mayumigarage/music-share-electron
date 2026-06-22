/**
 * MusicShare — Player Proxy
 * Phase 6: Abstraction layer for the DOM-hosted YouTube player.
 */
import { DomYouTubePlayer } from './dom-youtube-player.js';
import type { PlayerMessage } from '../../shared/preload-api.js';

export class PlayerProxy {
  private player = new DomYouTubePlayer();

  loadTrack(resolvedVideoId: string): Promise<void> {
    return this.player.loadTrack(resolvedVideoId);
  }

  play(): void { this.player.play(); }

  pause(): void { this.player.pause(); }

  resume(): void { this.player.play(); }

  stop(): void { this.player.stop(); }

  seek(positionSeconds: number): void { this.player.seek(positionSeconds); }

  setVolume(volume: number): void { this.player.setVolume(volume); }

  onMessage(callback: (message: PlayerMessage) => void): () => void {
    return this.player.onMessage(callback);
  }

}

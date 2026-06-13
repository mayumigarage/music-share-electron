/**
 * MusicShare — Player Proxy
 * Phase 6: Abstraction layer for player operations (Renderer → Preload → Main → WebContentsView).
 */

import type { MusicServiceType } from '../../shared/models.js';

export class PlayerProxy {
  loadTrack(url: string, service: MusicServiceType): void {
    window.electronAPI.sendToPlayer({ type: 'loadTrack', url, service });
  }

  play(): void {
    window.electronAPI.sendToPlayer({ type: 'play' });
  }

  pause(): void {
    window.electronAPI.sendToPlayer({ type: 'pause' });
  }

  resume(): void {
    window.electronAPI.sendToPlayer({ type: 'play' });
  }

  stop(): void {
    window.electronAPI.sendToPlayer({ type: 'stop' });
  }

  seek(positionSeconds: number): void {
    window.electronAPI.sendToPlayer({ type: 'seek', positionSeconds });
  }

  setVolume(volume: number): void {
    window.electronAPI.sendToPlayer({ type: 'setVolume', volume });
  }

  onMessage(callback: (message: import('../../shared/preload-api').PlayerMessage) => void): () => void {
    return window.electronAPI.onPlayerMessage(callback);
  }

  /**
   * Subscribe specifically to Spotify SDK initialization_error messages.
   * This surfaces the exact error string from the SDK when EME/Widevine
   * is unavailable or mis-configured, which is critical for diagnosing
   * "Failed to initialize player" issues in Electron builds that lack
   * the Widevine CDM binaries.
   */
  onInitializationError(callback: (message: string) => void): () => void {
    return this.onMessage((msg) => {
      if (msg.type === 'error' && msg.error.startsWith('init|')) {
        const detail = msg.error.slice(5); // strip 'init|' prefix
        console.error('[PlayerProxy] Spotify initialization_error:', detail);
        callback(detail);
      }
    });
  }
}

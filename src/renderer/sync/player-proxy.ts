/**
 * MusicShare — Player Proxy
 * Phase 6: Abstraction layer for player operations (Renderer → Preload → Main → WebContentsView).
 */

export class PlayerProxy {
  loadTrack(resolvedVideoId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const unsub = this.onMessage((msg) => {
        if (msg.type === 'loaded') {
          if (!resolved) {
            resolved = true;
            unsub();
            clearTimeout(timer);
            resolve();
          }
        }
        if (msg.type === 'error') {
          if (!resolved) {
            resolved = true;
            unsub();
            clearTimeout(timer);
            reject(new Error(msg.error));
          }
        }
      });

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          unsub();
          reject(new Error('loadTrack timed out after 30s'));
        }
      }, 30000);

      window.electronAPI.sendToPlayer({ type: 'loadTrack', resolvedVideoId });
    });
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

}

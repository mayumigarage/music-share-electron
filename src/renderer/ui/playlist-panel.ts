/**
 * MusicShare — Playlist Panel (Left Sidebar)
 * Phase 6: Dummy navigation for Phase 1. Playlist functionality is future work.
 */

export class PlaylistPanel {
  init(): void {
    const items = document.querySelectorAll<HTMLElement>('#left-panel .nav-item');
    items.forEach((item) => {
      item.addEventListener('click', () => {
        // Remove active from siblings
        items.forEach((i) => i.classList.remove('active'));
        item.classList.add('active');

        const view = item.dataset.view;
        const playlist = item.dataset.playlist;

        if (view || playlist) {
          // Phase 1: show "Coming Soon" toast via global event or noop
          this.showComingSoon();
        }
      });
    });

    const createBtn = document.getElementById('btn-create-playlist');
    createBtn?.addEventListener('click', () => this.showComingSoon());
  }

  private showComingSoon(): void {
    // Dispatch a custom event that AppUI can listen to, or rely on console
    // For simplicity, we'll use a small global handler pattern
    const toastEvent = new CustomEvent('musicshare:toast', {
      detail: { message: 'この機能は今後追加されます', type: 'info' as const },
    });
    window.dispatchEvent(toastEvent);
  }
}

// Listen for toast events from sub-modules
window.addEventListener('musicshare:toast', (e: Event) => {
  const detail = (e as CustomEvent).detail as { message: string; type: 'info' | 'success' | 'error' };
  // AppUI will also listen; this is a fallback
  console.log('[PlaylistPanel]', detail.message);
});

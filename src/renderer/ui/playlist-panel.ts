/**
 * MusicShare — Playlist Panel (Left Sidebar)
 * Phase 6: Dummy navigation for Phase 1. Playlist functionality is future work.
 */

export class PlaylistPanel {
  init(): void {
    const items = document.querySelectorAll<HTMLButtonElement>('#playlist-grid .playlist-card');
    items.forEach((item) => {
      item.addEventListener('click', () => {
        items.forEach((i) => i.classList.remove('active'));
        item.classList.add('active');

        const detail = {
          id: item.dataset.playlist ?? '',
          name: item.dataset.playlistName ?? 'プレイリスト',
          icon: item.querySelector<HTMLElement>('.playlist-cover')?.dataset.playlistIcon ?? 'musical-note',
        };
        window.dispatchEvent(new CustomEvent('musicshare:playlist-selected', { detail }));
      });
    });
  }
}

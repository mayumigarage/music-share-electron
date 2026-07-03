/**
 * MusicShare — Playlist Panel (Left Sidebar)
 */

import type { Playlist } from '../../shared/models.js';
import { isIconName, setIcon } from './icons.js';

export class PlaylistPanel {
  private gridEl = document.getElementById('playlist-grid') as HTMLElement;
  private countEl = document.getElementById('playlist-count') as HTMLElement;
  private createBtn = document.getElementById('btn-create-playlist') as HTMLButtonElement;
  private importBtn = document.getElementById('btn-import-playlist') as HTMLButtonElement;

  constructor(
    private onCreatePlaylist: () => void,
    private onImportPlaylist: () => void,
  ) {}

  init(): void {
    this.createBtn.addEventListener('click', () => this.onCreatePlaylist());
    this.importBtn.addEventListener('click', () => this.onImportPlaylist());
  }

  render(playlists: Playlist[], selectedPlaylistId: string): void {
    this.countEl.textContent = `${playlists.length}件`;
    this.gridEl.replaceChildren();

    const fragment = document.createDocumentFragment();
    playlists.forEach((playlist) => {
      const card = document.createElement('button');
      card.className = 'playlist-card';
      card.classList.toggle('active', playlist.id === selectedPlaylistId);
      card.type = 'button';
      card.dataset.playlist = playlist.id;
      card.dataset.playlistName = playlist.name;

      const cover = document.createElement('span');
      cover.className = 'playlist-cover';
      cover.dataset.playlistIcon = playlist.icon;
      setIcon(cover, isIconName(playlist.icon) ? playlist.icon : 'musical-note');

      const name = document.createElement('span');
      name.className = 'playlist-name';
      name.textContent = playlist.name;

      card.append(cover, name);
      card.addEventListener('click', () => {
        const detail = {
          id: playlist.id,
          name: playlist.name,
          icon: playlist.icon,
        };
        window.dispatchEvent(new CustomEvent('musicshare:playlist-selected', { detail }));
      });
      fragment.appendChild(card);
    });

    this.gridEl.appendChild(fragment);
  }
}

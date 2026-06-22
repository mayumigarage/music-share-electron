import type { Track } from '../../shared/models.js';

const STORAGE_KEY = 'musicshare:favorites:v1';

/** Local, per-user storage backing the Favorites playlist. */
export class FavoritesStore {
  private tracks: Track[];

  constructor() {
    this.tracks = this.load();
  }

  getTracks(): Track[] {
    return [...this.tracks];
  }

  has(trackId: string): boolean {
    return this.tracks.some((track) => track.id === trackId);
  }

  toggle(track: Track): boolean {
    const index = this.tracks.findIndex((favorite) => favorite.id === track.id);
    if (index >= 0) {
      this.tracks.splice(index, 1);
      this.persist();
      return false;
    }

    this.tracks.unshift({ ...track });
    this.persist();
    return true;
  }

  private load(): Track[] {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (!value) return [];
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as Track[] : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tracks));
    } catch {
      // Storage may be unavailable in restricted environments; the UI remains usable for this session.
    }
  }
}

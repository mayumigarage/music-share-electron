import { MusicServiceType, type Playlist, type PlaylistTrack, type Track } from '../../shared/models.js';

const STORAGE_KEY = 'musicshare:playlists:v1';
const LEGACY_FAVORITES_KEY = 'musicshare:favorites:v1';

export const FAVORITES_PLAYLIST_ID = 'favorites';
export const RECENT_PLAYLIST_ID = 'recent';

type PlaylistMutationResult = 'added' | 'duplicate' | 'missing' | 'readonly';
type PlaylistBatchMutationResult = {
  added: number;
  duplicate: number;
  missing: boolean;
};

const retiredDefaultPlaylistIds = new Set(['work', 'drive']);

export class PlaylistStore {
  private playlists: Playlist[];
  private saveChain: Promise<void> = Promise.resolve();

  constructor() {
    this.playlists = this.createDefaultPlaylists();
  }

  async initialize(): Promise<void> {
    const stored = await this.loadStoredPlaylists();
    if (stored) {
      this.playlists = this.ensureFavoritesPlaylist(stored);
      return;
    }

    const legacy = this.loadLegacyStoredPlaylists();
    if (legacy) {
      this.playlists = this.ensureFavoritesPlaylist(legacy);
      this.persist();
      return;
    }

    this.playlists = this.createDefaultPlaylists();
    this.persist();
  }

  getPlaylists(): Playlist[] {
    return this.playlists.map((playlist) => this.clonePlaylist(playlist));
  }

  getEditablePlaylists(): Playlist[] {
    return this.playlists.map((playlist) => this.clonePlaylist(playlist));
  }

  getPlaylist(playlistId: string): Playlist | null {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    return playlist ? this.clonePlaylist(playlist) : null;
  }

  getTracks(playlistId: string): PlaylistTrack[] {
    return this.getPlaylist(playlistId)?.tracks ?? [];
  }

  canManagePlaylist(playlistId: string): boolean {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    return Boolean(playlist && !playlist.isBuiltin && playlist.kind === 'manual');
  }

  isWritablePlaylist(playlistId: string): boolean {
    return this.playlists.some((playlist) => playlist.id === playlistId);
  }

  hasTrack(playlistId: string, track: Track): boolean {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist) return false;

    const key = this.getTrackKey(track);
    return playlist.tracks.some((item) => this.getTrackKey(item) === key);
  }

  addTrack(playlistId: string, track: Track): PlaylistMutationResult {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist) return 'missing';

    const key = this.getTrackKey(track);
    if (playlist.tracks.some((item) => this.getTrackKey(item) === key)) {
      return 'duplicate';
    }

    const now = Date.now();
    playlist.tracks.unshift({
      ...track,
      addedBy: track.addedBy ?? '',
      addedAt: now,
    });
    playlist.updatedAt = now;
    this.persist();
    return 'added';
  }

  addTracks(playlistId: string, tracks: Track[]): PlaylistBatchMutationResult {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist) return { added: 0, duplicate: 0, missing: true };

    const existingKeys = new Set(playlist.tracks.map((track) => this.getTrackKey(track)));
    const now = Date.now();
    let duplicate = 0;
    const additions: PlaylistTrack[] = [];

    tracks.forEach((track) => {
      const key = this.getTrackKey(track);
      if (existingKeys.has(key)) {
        duplicate += 1;
        return;
      }
      existingKeys.add(key);
      additions.push({
        ...track,
        addedBy: track.addedBy ?? '',
        addedAt: now - additions.length,
      });
    });

    if (additions.length === 0) {
      return { added: 0, duplicate, missing: false };
    }

    playlist.tracks = [...additions, ...playlist.tracks];
    playlist.updatedAt = now;
    this.persist();
    return { added: additions.length, duplicate, missing: false };
  }

  removeTrack(playlistId: string, trackKey: string): boolean {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist) return false;

    const before = playlist.tracks.length;
    playlist.tracks = playlist.tracks.filter((track) => this.getTrackKey(track) !== trackKey);
    if (playlist.tracks.length === before) return false;

    playlist.updatedAt = Date.now();
    this.persist();
    return true;
  }

  reorderTracks(playlistId: string, trackKeys: string[]): boolean {
    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist || trackKeys.length !== playlist.tracks.length) return false;

    const byKey = new Map(playlist.tracks.map((track) => [this.getTrackKey(track), track]));
    const reordered = trackKeys.map((key) => byKey.get(key));
    if (reordered.some((track) => !track)) return false;

    playlist.tracks = reordered as PlaylistTrack[];
    playlist.updatedAt = Date.now();
    this.persist();
    return true;
  }

  toggleFavorite(track: Track): boolean {
    if (this.hasTrack(FAVORITES_PLAYLIST_ID, track)) {
      this.removeTrack(FAVORITES_PLAYLIST_ID, this.getTrackKey(track));
      return false;
    }

    this.addTrack(FAVORITES_PLAYLIST_ID, track);
    return true;
  }

  createPlaylist(name: string): Playlist {
    const now = Date.now();
    const playlist: Playlist = {
      id: `playlist-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      icon: 'musical-note',
      kind: 'manual',
      isBuiltin: false,
      tracks: [],
      createdAt: now,
      updatedAt: now,
    };
    this.playlists.push(playlist);
    this.persist();
    return this.clonePlaylist(playlist);
  }

  renamePlaylist(playlistId: string, name: string): boolean {
    if (!this.canManagePlaylist(playlistId)) return false;

    const playlist = this.playlists.find((item) => item.id === playlistId);
    if (!playlist) return false;

    playlist.name = name;
    playlist.updatedAt = Date.now();
    this.persist();
    return true;
  }

  deletePlaylist(playlistId: string): boolean {
    if (!this.canManagePlaylist(playlistId)) return false;

    const before = this.playlists.length;
    this.playlists = this.playlists.filter((playlist) => playlist.id !== playlistId);
    if (this.playlists.length === before) return false;

    this.persist();
    return true;
  }

  getTrackKey(track: Track): string {
    if (track.resolvedVideoId) {
      return `${track.service}:video:${track.resolvedVideoId}`;
    }

    const normalizedUrl = track.url.trim().toLowerCase();
    if (normalizedUrl) {
      return `${track.service}:url:${normalizedUrl}`;
    }

    return `${track.service}:meta:${track.title.trim().toLowerCase()}::${track.artist.trim().toLowerCase()}::${track.durationSeconds ?? ''}`;
  }

  private createDefaultPlaylists(): Playlist[] {
    const now = Date.now();
    const favorites = this.createBasePlaylist(
      FAVORITES_PLAYLIST_ID,
      'お気に入り',
      'heart-solid',
      'favorites',
      true,
      this.loadLegacyFavorites(),
      now,
    );

    return [favorites];
  }

  private async loadStoredPlaylists(): Promise<Playlist[] | null> {
    try {
      const stored = await window.electronAPI.loadPlaylists();
      if (!stored) return null;

      return this.normalizePlaylists(stored);
    } catch (error) {
      console.warn('[PlaylistStore] Failed to load userData playlists:', error);
      return null;
    }
  }

  private loadLegacyStoredPlaylists(): Playlist[] | null {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (!value) return null;

      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) return null;

      return this.normalizePlaylists(parsed);
    } catch {
      return null;
    }
  }

  private normalizePlaylists(items: unknown[]): Playlist[] | null {
    const playlists = items
      .map((item) => this.normalizePlaylist(item))
      .filter((playlist): playlist is Playlist => (
        playlist !== null
        && playlist.kind !== 'recent'
        && !(retiredDefaultPlaylistIds.has(playlist.id) && playlist.tracks.length === 0)
      ));

    return playlists.length > 0 ? playlists : null;
  }

  private ensureFavoritesPlaylist(playlists: Playlist[]): Playlist[] {
    if (playlists.some((playlist) => playlist.id === FAVORITES_PLAYLIST_ID)) {
      return playlists.map((playlist) => (
        playlist.id === FAVORITES_PLAYLIST_ID
          ? { ...playlist, kind: 'favorites', isBuiltin: true, icon: playlist.icon || 'heart-solid' }
          : playlist
      ));
    }

    const now = Date.now();
    return [
      this.createBasePlaylist(FAVORITES_PLAYLIST_ID, 'お気に入り', 'heart-solid', 'favorites', true, [], now),
      ...playlists,
    ];
  }

  private createBasePlaylist(
    id: string,
    name: string,
    icon: string,
    kind: Playlist['kind'],
    isBuiltin: boolean,
    tracks: PlaylistTrack[],
    timestamp: number,
  ): Playlist {
    return {
      id,
      name,
      icon,
      kind,
      isBuiltin,
      tracks,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private loadLegacyFavorites(): PlaylistTrack[] {
    try {
      const value = window.localStorage.getItem(LEGACY_FAVORITES_KEY);
      if (!value) return [];

      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];

      const now = Date.now();
      return parsed
        .map((item, index) => this.normalizeTrack(item, now - index))
        .filter((track): track is PlaylistTrack => track !== null);
    } catch {
      return [];
    }
  }

  private normalizePlaylist(item: unknown): Playlist | null {
    const data = item as Partial<Playlist>;
    if (typeof data.id !== 'string' || typeof data.name !== 'string') return null;
    if (data.id === RECENT_PLAYLIST_ID) return null;

    const now = Date.now();
    const tracks = Array.isArray(data.tracks)
      ? data.tracks
        .map((track, index) => this.normalizeTrack(track, now - index))
        .filter((track): track is PlaylistTrack => track !== null)
      : [];
    const kind: Playlist['kind'] = data.id === FAVORITES_PLAYLIST_ID ? 'favorites' : 'manual';

    return {
      id: data.id,
      name: data.name,
      icon: typeof data.icon === 'string' && data.icon ? data.icon : kind === 'favorites' ? 'heart-solid' : 'musical-note',
      kind,
      isBuiltin: data.id === FAVORITES_PLAYLIST_ID,
      tracks,
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : now,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : now,
    };
  }

  private normalizeTrack(item: unknown, fallbackAddedAt: number): PlaylistTrack | null {
    const data = item as Partial<PlaylistTrack>;
    if (
      typeof data.id !== 'string'
      || typeof data.url !== 'string'
      || typeof data.title !== 'string'
      || typeof data.artist !== 'string'
      || typeof data.thumbnailUrl !== 'string'
      || !this.isMusicService(data.service)
    ) {
      return null;
    }

    return {
      id: data.id,
      url: data.url,
      resolvedVideoId: typeof data.resolvedVideoId === 'string' ? data.resolvedVideoId : null,
      title: data.title,
      artist: data.artist,
      thumbnailUrl: data.thumbnailUrl,
      durationSeconds: typeof data.durationSeconds === 'number' ? data.durationSeconds : null,
      addedBy: typeof data.addedBy === 'string' ? data.addedBy : '',
      service: data.service,
      addedAt: typeof data.addedAt === 'number' ? data.addedAt : fallbackAddedAt,
    };
  }

  private isMusicService(value: unknown): value is MusicServiceType {
    return typeof value === 'string' && Object.values(MusicServiceType).includes(value as MusicServiceType);
  }

  private clonePlaylist(playlist: Playlist): Playlist {
    return {
      ...playlist,
      tracks: playlist.tracks.map((track) => ({ ...track })),
    };
  }

  private persist(): void {
    const snapshot = this.getPlaylists();
    this.saveChain = this.saveChain
      .catch(() => undefined)
      .then(() => window.electronAPI.savePlaylists(snapshot))
      .catch((error) => {
        console.warn('[PlaylistStore] Failed to save userData playlists:', error);
      });
  }
}

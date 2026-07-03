/**
 * MusicShare — Local playlist persistence.
 *
 * Playlists are per-user application data and live under Electron's userData
 * directory so app reinstalls do not overwrite them.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const PLAYLISTS_FILENAME = 'playlists.json';
const MAX_PLAYLISTS = 250;
const MAX_TRACKS_PER_PLAYLIST = 5_000;

function getPlaylistsFilePath(): string {
  return path.join(app.getPath('userData'), PLAYLISTS_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlaylistPayload(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length > MAX_PLAYLISTS) return false;

  return value.every((playlist) => {
    if (!isRecord(playlist)) return false;
    if (typeof playlist.id !== 'string' || typeof playlist.name !== 'string') return false;
    const tracks = playlist.tracks;
    return Array.isArray(tracks) && tracks.length <= MAX_TRACKS_PER_PLAYLIST;
  });
}

function unwrapPlaylistPayload(value: unknown): unknown[] | null {
  if (isPlaylistPayload(value)) return value;

  if (isRecord(value) && isPlaylistPayload(value.playlists)) {
    return value.playlists;
  }

  return null;
}

export async function loadPlaylists(): Promise<unknown[] | null> {
  const playlistFile = getPlaylistsFilePath();
  if (!fs.existsSync(playlistFile)) return null;

  const value = await fs.promises.readFile(playlistFile, 'utf8');
  const parsed: unknown = JSON.parse(value);
  return unwrapPlaylistPayload(parsed);
}

export async function savePlaylists(playlists: unknown): Promise<void> {
  if (!isPlaylistPayload(playlists)) {
    throw new TypeError('playlists must be an array of playlist objects');
  }

  const playlistFile = getPlaylistsFilePath();
  await fs.promises.mkdir(path.dirname(playlistFile), { recursive: true });
  await fs.promises.writeFile(playlistFile, `${JSON.stringify(playlists, null, 2)}\n`, 'utf8');
}

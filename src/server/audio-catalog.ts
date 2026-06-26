/**
 * MusicShare — Authorized audio-only catalog
 *
 * This module intentionally resolves only audio URLs that the application owner
 * has explicitly configured. It does not inspect provider pages, extract media
 * streams, or proxy audio bytes through the server.
 *
 * Configure with MUSICSHARE_AUDIO_CATALOG_JSON, for example:
 * [
 *   {
 *     "id": "demo-track",
 *     "title": "Demo Track",
 *     "artist": "MusicShare",
 *     "audioUrl": "https://cdn.example.com/audio/demo-track.opus",
 *     "thumbnailUrl": "https://cdn.example.com/audio/demo-track.jpg"
 *   }
 * ]
 */

export interface AudioCatalogItem {
  id: string;
  title: string;
  artist?: string;
  audioUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

export interface AudioSearchResult {
  id: string;
  title: string;
  artist?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

const BLOCKED_HOST_PATTERNS = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)youtube-nocookie\.com$/i,
  /(^|\.)googlevideo\.com$/i,
];

function parseCatalog(): AudioCatalogItem[] {
  const raw = process.env.MUSICSHARE_AUDIO_CATALOG_JSON;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn('[AudioCatalog] MUSICSHARE_AUDIO_CATALOG_JSON must be a JSON array.');
      return [];
    }

    return parsed.flatMap((item) => {
      const normalized = normalizeCatalogItem(item);
      return normalized ? [normalized] : [];
    });
  } catch (error) {
    console.warn('[AudioCatalog] Failed to parse MUSICSHARE_AUDIO_CATALOG_JSON:', error);
    return [];
  }
}

function normalizeCatalogItem(value: unknown): AudioCatalogItem | null {
  if (!value || typeof value !== 'object') return null;

  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const audioUrl = typeof item.audioUrl === 'string' ? item.audioUrl.trim() : '';
  const artist = typeof item.artist === 'string' ? item.artist.trim() : undefined;
  const thumbnailUrl = typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl.trim() : undefined;
  const durationSeconds = typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds)
    ? item.durationSeconds
    : undefined;

  if (!id || !title || !audioUrl) return null;
  if (!isAllowedAudioUrl(audioUrl)) return null;
  if (thumbnailUrl && !isHttpUrl(thumbnailUrl)) return null;

  return {
    id,
    title,
    artist,
    audioUrl,
    thumbnailUrl,
    durationSeconds,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isAllowedAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return !BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

function toSearchResult(item: AudioCatalogItem): AudioSearchResult {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: item.durationSeconds,
  };
}

export function searchAudioCatalog(query: string): AudioSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const catalog = parseCatalog();

  if (!normalizedQuery) {
    return catalog.slice(0, 25).map(toSearchResult);
  }

  return catalog
    .filter((item) => {
      const searchable = `${item.title} ${item.artist ?? ''} ${item.id}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    })
    .slice(0, 25)
    .map(toSearchResult);
}

export function resolveAuthorizedAudio(sourceId: string): AudioCatalogItem | null {
  const normalizedId = sourceId.trim();
  if (!normalizedId) return null;

  return parseCatalog().find((item) => item.id === normalizedId) ?? null;
}

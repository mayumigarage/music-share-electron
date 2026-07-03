/**
 * MusicShare — External playlist import.
 *
 * Main owns provider access so renderer code never touches provider tokens,
 * provider API keys, or Node.js APIs directly.
 */

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { MusicServiceType } from '../shared/models';
import type { PlaylistImportResult, ResolvedTrack } from '../shared/preload-api';
import { resolveBestYouTubeCandidateForMetadata } from './track-resolver';

const MAX_IMPORT_TRACKS = 2000;
const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';
const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_API_KEY_FILENAME = 'youtube-data-api-key.txt';
const SPOTIFY_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

interface PlaylistImportOptions {
  getSpotifyAccessToken: () => Promise<string | null>;
}

interface SpotifyImage {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface SpotifyArtist {
  name?: unknown;
}

interface SpotifyTrackObject {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  is_local?: unknown;
  duration_ms?: unknown;
  external_urls?: {
    spotify?: unknown;
  };
  artists?: SpotifyArtist[];
  album?: {
    images?: SpotifyImage[];
  };
}

interface SpotifyPlaylistItem {
  track?: SpotifyTrackObject | null;
}

interface SpotifyPaging<T> {
  items?: T[];
  next?: string | null;
  total?: number;
}

interface SpotifyPlaylistResponse {
  name?: unknown;
  tracks?: SpotifyPaging<SpotifyPlaylistItem>;
}

interface SpotifyTrackMetadata {
  url: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
}

interface YouTubePlaylistEntry {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

interface YouTubePlaylistItemsResponse {
  nextPageToken?: string;
  pageInfo?: {
    totalResults?: number;
  };
  items?: Array<{
    snippet?: {
      title?: string;
      channelTitle?: string;
      videoOwnerChannelTitle?: string;
      thumbnails?: Record<string, { url?: string; width?: number }>;
      resourceId?: {
        videoId?: string;
      };
    };
    contentDetails?: {
      videoId?: string;
    };
    status?: {
      privacyStatus?: string;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

interface YouTubeVideosResponse {
  items?: Array<{
    id?: string;
    contentDetails?: {
      duration?: string;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

interface YouTubePlaylistResponse {
  items?: Array<{
    snippet?: {
      title?: string;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getYouTubeApiKey(): string {
  const envKey = process.env.YOUTUBE_DATA_API_KEY || process.env.GOOGLE_API_KEY;
  if (envKey?.trim()) return envKey.trim();

  const candidatePaths = [
    path.join(process.resourcesPath, YOUTUBE_API_KEY_FILENAME),
    path.join(app.getAppPath(), 'resources', YOUTUBE_API_KEY_FILENAME),
    path.join(process.cwd(), 'resources', YOUTUBE_API_KEY_FILENAME),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      if (!fs.existsSync(candidatePath)) continue;
      const value = fs.readFileSync(candidatePath, 'utf8').trim();
      if (value) return value;
    } catch (error) {
      console.warn('[PlaylistImporter] Failed to read YouTube Data API key file:', error);
    }
  }

  return '';
}

function requestText(
  urlString: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.get(urlString, { headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, body }));
    });

    request.on('error', reject);
    request.setTimeout(20_000, () => {
      request.destroy(new Error('Request timeout'));
    });
  });
}

async function requestJson<T>(
  urlString: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: string; data: T | null }> {
  const result = await requestText(urlString, headers);
  try {
    return { ...result, data: JSON.parse(result.body) as T };
  } catch {
    return { ...result, data: null };
  }
}

function extractSpotifyPlaylistId(sourceUrl: string): string | null {
  const spotifyUriMatch = sourceUrl.match(/^spotify:playlist:([A-Za-z0-9]{22})$/u);
  if (spotifyUriMatch) return spotifyUriMatch[1];

  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    if (host !== 'open.spotify.com' && host !== 'spotify.com') return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    const playlistIndex = segments.indexOf('playlist');
    const playlistId = playlistIndex >= 0 ? segments[playlistIndex + 1] : null;
    return playlistId && SPOTIFY_PLAYLIST_ID_PATTERN.test(playlistId) ? playlistId : null;
  } catch {
    return null;
  }
}

function isYouTubePlaylistUrl(sourceUrl: string): boolean {
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    const isYouTubeHost = host === 'youtube.com'
      || host === 'youtu.be'
      || host === 'music.youtube.com'
      || host.endsWith('.youtube.com');
    return isYouTubeHost && (parsed.pathname.startsWith('/playlist') || parsed.searchParams.has('list'));
  } catch {
    return false;
  }
}

function extractYouTubePlaylistId(sourceUrl: string): string | null {
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    const isYouTubeHost = host === 'youtube.com'
      || host === 'youtu.be'
      || host === 'music.youtube.com'
      || host.endsWith('.youtube.com');
    if (!isYouTubeHost) return null;

    const playlistId = parsed.searchParams.get('list');
    return playlistId?.trim() || null;
  } catch {
    return null;
  }
}

function makeYouTubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function buildApiUrl(pathname: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(`${YOUTUBE_API_BASE_URL}/${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function parseIso8601Duration(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? total : null;
}

function getBestYouTubeThumbnail(
  thumbnails: Record<string, { url?: string; width?: number }> | undefined,
): string {
  if (!thumbnails) return '';
  return Object.values(thumbnails)
    .filter((thumbnail): thumbnail is { url: string; width?: number } => typeof thumbnail.url === 'string' && thumbnail.url.length > 0)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? '';
}

function normalizeYouTubePlaylistItem(
  item: NonNullable<YouTubePlaylistItemsResponse['items']>[number],
): YouTubePlaylistEntry | null {
  const snippet = item.snippet;
  const videoId = item.contentDetails?.videoId || snippet?.resourceId?.videoId || '';
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) return null;

  const title = snippet?.title?.trim() || '';
  const privacyStatus = item.status?.privacyStatus?.toLowerCase();
  if (!title || title === 'Private video' || title === 'Deleted video' || privacyStatus === 'private') {
    return null;
  }

  return {
    videoId,
    title,
    channelTitle: snippet?.videoOwnerChannelTitle?.trim() || snippet?.channelTitle?.trim() || 'YouTube',
    thumbnailUrl: getBestYouTubeThumbnail(snippet?.thumbnails) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

function getBestSpotifyImage(images: SpotifyImage[] | undefined): string {
  if (!Array.isArray(images)) return '';
  const sorted = [...images].sort((a, b) => (getFiniteNumber(b.width) ?? 0) - (getFiniteNumber(a.width) ?? 0));
  return getString(sorted.find((image) => getString(image.url))?.url) ?? '';
}

function normalizeSpotifyItem(item: SpotifyPlaylistItem): SpotifyTrackMetadata | null {
  const track = item.track;
  if (!track || track.is_local === true || track.type !== 'track') return null;

  const trackId = getString(track.id);
  const title = getString(track.name);
  if (!trackId || !SPOTIFY_PLAYLIST_ID_PATTERN.test(trackId) || !title) return null;

  const artists = Array.isArray(track.artists)
    ? track.artists.map((artist) => getString(artist.name)).filter((name): name is string => name !== null)
    : [];
  const durationMs = getFiniteNumber(track.duration_ms);

  return {
    url: getString(track.external_urls?.spotify) ?? `https://open.spotify.com/track/${trackId}`,
    title,
    artist: artists.join(', ') || 'Unknown Artist',
    thumbnailUrl: getBestSpotifyImage(track.album?.images),
    durationSeconds: durationMs === null ? null : Math.round(durationMs / 1000),
  };
}

function isSpotifyPlaylistResponse(
  data: SpotifyPlaylistResponse | SpotifyPaging<SpotifyPlaylistItem>,
): data is SpotifyPlaylistResponse {
  return Object.prototype.hasOwnProperty.call(data, 'tracks');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function resolveSpotifyTrack(metadata: SpotifyTrackMetadata): Promise<ResolvedTrack> {
  try {
    const candidate = await resolveBestYouTubeCandidateForMetadata(
      metadata.url,
      metadata.title,
      metadata.artist,
      MusicServiceType.Spotify,
      metadata.durationSeconds,
    );
    if (candidate?.resolvedVideoId) {
      return {
        id: generateId(),
        url: metadata.url,
        resolvedVideoId: candidate.resolvedVideoId,
        title: metadata.title,
        artist: metadata.artist,
        thumbnailUrl: metadata.thumbnailUrl || candidate.thumbnailUrl,
        durationSeconds: metadata.durationSeconds ?? candidate.durationSeconds,
        service: MusicServiceType.Spotify,
      };
    }
  } catch (error) {
    console.warn('[PlaylistImporter] Failed to resolve Spotify track playback candidate:', error);
  }

  return {
    id: generateId(),
    url: metadata.url,
    resolvedVideoId: null,
    title: metadata.title,
    artist: metadata.artist,
    thumbnailUrl: metadata.thumbnailUrl,
    durationSeconds: metadata.durationSeconds,
    service: MusicServiceType.Spotify,
  };
}

async function importSpotifyPlaylist(
  sourceUrl: string,
  playlistId: string,
  options: PlaylistImportOptions,
): Promise<PlaylistImportResult> {
  const token = await options.getSpotifyAccessToken();
  if (!token) {
    throw new Error('Spotify プレイリストの取り込みには Spotify ログインが必要です。');
  }

  let playlistTitle = 'Spotify プレイリスト';
  let nextUrl: string | null = `${SPOTIFY_API_BASE_URL}/playlists/${playlistId}?market=from_token`;
  let totalCount = 0;
  let skippedCount = 0;
  const metadata: SpotifyTrackMetadata[] = [];

  while (nextUrl && metadata.length < MAX_IMPORT_TRACKS) {
    const response: {
      statusCode: number;
      body: string;
      data: SpotifyPlaylistResponse | SpotifyPaging<SpotifyPlaylistItem> | null;
    } = await requestJson<SpotifyPlaylistResponse | SpotifyPaging<SpotifyPlaylistItem>>(
      nextUrl,
      { Authorization: `Bearer ${token}` },
    );

    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new Error('Spotify プレイリストを読み込めませんでした。Spotify に再ログインしてください。');
    }
    if (response.statusCode < 200 || response.statusCode >= 300 || !response.data) {
      throw new Error('Spotify プレイリストを読み込めませんでした。URL と公開範囲を確認してください。');
    }

    const data = response.data;
    const page: SpotifyPaging<SpotifyPlaylistItem> | undefined = isSpotifyPlaylistResponse(data)
      ? data.tracks
      : data;
    if (isSpotifyPlaylistResponse(data)) {
      playlistTitle = getString(data.name) ?? playlistTitle;
    }
    if (!page || !Array.isArray(page.items)) break;

    totalCount = typeof page.total === 'number' ? page.total : totalCount;
    for (const item of page.items) {
      if (metadata.length >= MAX_IMPORT_TRACKS) break;
      const normalized = normalizeSpotifyItem(item);
      if (normalized) {
        metadata.push(normalized);
      } else {
        skippedCount += 1;
      }
    }
    nextUrl = page.next ?? null;
  }

  const tracks = await mapWithConcurrency(metadata, 3, (item) => resolveSpotifyTrack(item));
  const unresolvedCount = tracks.filter((track) => !track.resolvedVideoId).length;
  const reportedTotal = totalCount || metadata.length + skippedCount;

  return {
    source: MusicServiceType.Spotify,
    sourceUrl,
    title: playlistTitle,
    tracks,
    totalCount: reportedTotal,
    skippedCount,
    unresolvedCount,
    isPartial: reportedTotal > metadata.length + skippedCount,
  };
}

function normalizeYouTubeEntry(entry: YouTubePlaylistEntry): ResolvedTrack | null {
  return {
    id: generateId(),
    url: makeYouTubeVideoUrl(entry.videoId),
    resolvedVideoId: entry.videoId,
    title: entry.title,
    artist: entry.channelTitle,
    thumbnailUrl: entry.thumbnailUrl,
    durationSeconds: null,
    service: MusicServiceType.YouTube,
  };
}

async function importYouTubePlaylist(sourceUrl: string): Promise<PlaylistImportResult> {
  const playlistId = extractYouTubePlaylistId(sourceUrl);
  if (!playlistId) {
    throw new Error('YouTube プレイリストIDを取得できませんでした。playlist?list=... 形式のURLを指定してください。');
  }
  const apiKey = getYouTubeApiKey();
  if (!apiKey) {
    throw new Error('YouTube Data API キーが設定されていません。YOUTUBE_DATA_API_KEY または同梱キーファイルを設定してください。');
  }

  const playlistTitle = await fetchYouTubePlaylistTitle(playlistId, apiKey);
  const { entries, totalCount, skippedCount } = await fetchYouTubePlaylistEntries(playlistId, apiKey);
  const durationByVideoId = await fetchYouTubeDurations(entries.map((entry) => entry.videoId), apiKey);
  const tracks = entries.map((entry) => ({
    ...normalizeYouTubeEntry(entry)!,
    durationSeconds: durationByVideoId.get(entry.videoId) ?? null,
  }));

  if (tracks.length === 0) {
    throw new Error('YouTube プレイリストの曲を取得できませんでした。URLを確認してください。');
  }

  return {
    source: MusicServiceType.YouTube,
    sourceUrl,
    title: playlistTitle,
    tracks,
    totalCount,
    skippedCount,
    unresolvedCount: 0,
    isPartial: totalCount > tracks.length + skippedCount,
  };
}

async function fetchYouTubePlaylistTitle(playlistId: string, apiKey: string): Promise<string> {
  const response = await requestJson<YouTubePlaylistResponse>(buildApiUrl('playlists', {
    part: 'snippet',
    id: playlistId,
    key: apiKey,
  }));
  if (response.statusCode < 200 || response.statusCode >= 300 || response.data?.error) {
    throw new Error(formatYouTubeApiError(response.data?.error?.message));
  }
  return response.data?.items?.[0]?.snippet?.title?.trim() || 'YouTube プレイリスト';
}

async function fetchYouTubePlaylistEntries(
  playlistId: string,
  apiKey: string,
): Promise<{ entries: YouTubePlaylistEntry[]; totalCount: number; skippedCount: number }> {
  const entries: YouTubePlaylistEntry[] = [];
  const seenVideoIds = new Set<string>();
  let skippedCount = 0;
  let totalCount = 0;
  let pageToken: string | undefined;

  do {
    const response = await requestJson<YouTubePlaylistItemsResponse>(buildApiUrl('playlistItems', {
      part: 'snippet,contentDetails,status',
      playlistId,
      maxResults: 50,
      pageToken,
      key: apiKey,
    }));
    if (response.statusCode < 200 || response.statusCode >= 300 || response.data?.error) {
      throw new Error(formatYouTubeApiError(response.data?.error?.message));
    }

    const data = response.data;
    const items = data?.items ?? [];
    totalCount = data?.pageInfo?.totalResults ?? totalCount;
    for (const item of items) {
      if (entries.length >= MAX_IMPORT_TRACKS) break;
      const entry = normalizeYouTubePlaylistItem(item);
      if (!entry || seenVideoIds.has(entry.videoId)) {
        skippedCount += 1;
        continue;
      }
      seenVideoIds.add(entry.videoId);
      entries.push(entry);
    }
    pageToken = data?.nextPageToken;
  } while (pageToken && entries.length < MAX_IMPORT_TRACKS);

  return { entries, totalCount: totalCount || entries.length + skippedCount, skippedCount };
}

async function fetchYouTubeDurations(videoIds: string[], apiKey: string): Promise<Map<string, number | null>> {
  const durationByVideoId = new Map<string, number | null>();
  for (let index = 0; index < videoIds.length; index += 50) {
    const ids = videoIds.slice(index, index + 50);
    const response = await requestJson<YouTubeVideosResponse>(buildApiUrl('videos', {
      part: 'contentDetails',
      id: ids.join(','),
      key: apiKey,
    }));
    if (response.statusCode < 200 || response.statusCode >= 300 || response.data?.error) {
      console.warn('[PlaylistImporter] Failed to fetch YouTube video durations:', response.data?.error?.message ?? response.body);
      continue;
    }
    for (const item of response.data?.items ?? []) {
      if (!item.id) continue;
      durationByVideoId.set(item.id, parseIso8601Duration(item.contentDetails?.duration));
    }
  }
  return durationByVideoId;
}

function formatYouTubeApiError(message: string | undefined): string {
  return (
    message
      ? `YouTube Data API でプレイリストを取得できませんでした: ${message}`
      : 'YouTube Data API でプレイリストを取得できませんでした。APIキーとURLを確認してください。'
  );
}

export async function importPlaylist(
  sourceUrl: string,
  options: PlaylistImportOptions,
): Promise<PlaylistImportResult> {
  const normalizedUrl = sourceUrl.trim();
  if (!normalizedUrl) {
    throw new Error('Spotify または YouTube のプレイリストURLを入力してください。');
  }

  const spotifyPlaylistId = extractSpotifyPlaylistId(normalizedUrl);
  if (spotifyPlaylistId) {
    return importSpotifyPlaylist(normalizedUrl, spotifyPlaylistId, options);
  }

  if (isYouTubePlaylistUrl(normalizedUrl)) {
    return importYouTubePlaylist(normalizedUrl);
  }

  throw new Error('Spotify または YouTube のプレイリストURLを入力してください。');
}

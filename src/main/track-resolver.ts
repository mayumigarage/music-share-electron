/**
 * MusicShare — Track Resolver
 * Phase 3.12–3.16: Resolve track URLs to metadata using Node.js https/fetch
 * to avoid CORS issues in the renderer.
 */

import * as https from 'https';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { promisify } from 'util';
import { app } from 'electron';
import { appendAppLog } from './crash-handler';
import type {
  TrackResolutionResult,
  TrackSearchCandidate,
  TrackSearchResult,
  TrackResolveOptions,
  ResolvedTrack,
  TrackResolutionError,
  TrackResolverDebugLog,
  YouTubeMusicCandidatesResult,
} from '../shared/preload-api';
import { MusicServiceType } from '../shared/models';

const execFileAsync = promisify(execFile);

/**
 * Packaged Windows builds carry their own yt-dlp binary so recipients do not
 * need to install it or configure PATH. Development keeps using PATH, which
 * makes local updates and debugging straightforward.
 */
function getYtDlpCommand(): string {
  if (!app.isPackaged) return 'yt-dlp';

  const bundledBinary = path.join(process.resourcesPath, 'tools', 'yt-dlp.exe');
  if (!fs.existsSync(bundledBinary)) {
    throw new Error(`Bundled yt-dlp was not found: ${bundledBinary}`);
  }
  return bundledBinary;
}
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const MAX_CANDIDATES_PER_SERVICE = 6;
const RESOLUTION_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RESOLUTION_CACHE_ENTRIES = 100;

type YtDlpError = Error & {
  code?: number | string;
  killed?: boolean;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
};

type TrackResolverDebugLogger = (log: TrackResolverDebugLog) => void;
type YouTubeMusicCandidatesListener = (result: YouTubeMusicCandidatesResult) => void;

// Public metadata is resolved by the MusicShare server with its own Spotify
// Client Credentials token. This keeps the client secret out of distributed
// Electron applications and does not require guests to sign in to Spotify.
const MUSIC_SHARE_SERVER_URL = process.env.MUSIC_SHARE_SERVER_URL
  || 'https://music-share-electron-server.onrender.com';

interface CacheEntry<T> {
  expiresAt: number;
  value?: T;
  pending?: Promise<T>;
}

const metadataCache = new Map<string, CacheEntry<ResolvedTrack>>();
const candidateCache = new Map<string, CacheEntry<TrackSearchCandidate[]>>();

interface YouTubeMetadata {
  id: string;
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  urlString: string,
  headers?: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(urlString, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function detectService(url: string): MusicServiceType {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return MusicServiceType.YouTube;
  }
  if (lower.includes('spotify.com') || lower.includes('open.spotify.com')) {
    return MusicServiceType.Spotify;
  }
  if (lower.includes('music.apple.com') || lower.includes('itunes.apple.com')) {
    return MusicServiceType.AppleMusic;
  }
  if (isDirectVideoUrl(url)) {
    return MusicServiceType.DirectVideo;
  }
  // Default fallback so we still return a result
  return MusicServiceType.YouTube;
}

function isDirectVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.(mp4|m4v|webm|ogv|ogg|mov|m3u8)(?:$|[?#])/iu.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Extract a playable video ID from the common YouTube and YouTube Music URL forms. */
function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    let videoId: string | null = null;

    if (host === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] || null;
    } else if (host === 'youtube.com' || host === 'music.youtube.com' || host.endsWith('.youtube.com')) {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      } else {
        const [kind, id] = parsed.pathname.split('/').filter(Boolean);
        if (kind === 'shorts' || kind === 'embed' || kind === 'live') videoId = id || null;
      }
    }

    return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeCacheKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function normalizeUrlCacheKey(value: string): string {
  // URL paths and query values can be case-sensitive, so only trim whitespace.
  return value.trim();
}

function trimCache<T>(cache: Map<string, CacheEntry<T>>): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_RESOLUTION_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function getCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  load: () => Promise<T>,
): { value?: T; promise: Promise<T> } {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.value !== undefined) return { value: cached.value, promise: Promise.resolve(cached.value) };
    if (cached.pending) return { promise: cached.pending };
  }

  trimCache(cache);
  const entry: CacheEntry<T> = { expiresAt: Date.now() + RESOLUTION_CACHE_TTL_MS };
  const pending = load().then((value) => {
    entry.value = value;
    entry.pending = undefined;
    return value;
  }).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  entry.pending = pending;
  cache.set(key, entry);
  return { promise: pending };
}

function fallbackResult(url: string, service: MusicServiceType): ResolvedTrack {
  return {
    id: generateId(),
    url,
    resolvedVideoId: null,
    title: 'Unknown Track',
    artist: 'Unknown Artist',
    thumbnailUrl: '',
    durationSeconds: null,
    service,
    isFallback: true,
  };
}

function resolveDirectVideo(url: string): ResolvedTrack {
  const parsed = new URL(url);
  const filename = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || 'Video');
  const title = filename.replace(/\.[^.]+$/u, '').replace(/[-_]+/gu, ' ').trim() || 'Video';
  return {
    id: generateId(),
    url,
    resolvedVideoId: null,
    title,
    artist: parsed.hostname,
    thumbnailUrl: '',
    durationSeconds: null,
    service: MusicServiceType.DirectVideo,
  };
}

function logYtDlpFailure(detail: string): void {
  // Keep individual log entries readable and prevent unexpectedly large tool output.
  const compact = detail.replace(/\r?\n/g, '\\n').slice(0, 4_000);
  appendAppLog(`[TrackResolver] yt-dlp candidate search failed\n${compact}`);
}

function toCodePoints(value: string): string[] {
  return Array.from(value, (character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Spotify credits sometimes append character/voice-actor entries to the
 * artist list.  Those entries make YouTube Music queries unnecessarily long
 * and often steer results away from the release.  Keep the regular artists
 * when present, while retaining a cleaned character name for tracks that only
 * have a CV credit.
 */
function buildSearchQuery(artist: string, title: string): string {
  const rawArtists = artist.split(/[,，]/);
  const hasNonCvArtist = rawArtists.some((entry) => !/[（(]\s*CV\s*[:：]/iu.test(entry));
  const artists = rawArtists
    .filter((entry) => !hasNonCvArtist || !/[（(]\s*CV\s*[:：]/iu.test(entry))
    .map((entry) => entry
      // Remove both ASCII and full-width parentheses/brackets and all content
      // inside them, e.g. "日高零奈(CV:蔀 祐佳)" or "Artist [Remix]".
      .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|［[^］]*］/gu, '')
      .trim())
    .filter(Boolean);
  const cleanTitle = title.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|［[^］]*］/gu, '').trim();

  return [...artists, cleanTitle]
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Scores a fetched candidate instead of trusting the first item returned by a
 * search page.  Matching the Spotify duration is particularly useful for
 * Japanese titles, where word-token matching is not meaningful.
 */
function scoreYouTubeCandidate(
  candidate: YouTubeMetadata,
  expectedTitle: string,
  expectedArtist: string,
  expectedDuration: number | null,
): number {
  const title = normalizeForMatch(candidate.title);
  const uploader = normalizeForMatch(candidate.uploader);
  const expectedTitleNormalized = normalizeForMatch(expectedTitle);
  const expectedArtistNormalized = normalizeForMatch(expectedArtist);
  const combined = `${title}${uploader}`;
  let score = 0;

  if (title.includes(expectedTitleNormalized)) score += 70;
  if (combined.includes(expectedArtistNormalized)) score += 45;
  if (uploader.endsWith('topic')) score += 100;
  else if (uploader.includes(expectedArtistNormalized)) score += 65;
  if (/officialaudio|officialmusicvideo|officialvideo|musicvideo|mv/.test(title)) score += 30;

  if (expectedDuration !== null && candidate.duration !== null) {
    const difference = Math.abs(expectedDuration - candidate.duration);
    if (difference <= 3) score += 45;
    else if (difference <= 10) score += 30;
    else if (difference <= 25) score += 10;
    else if (difference >= 60) score -= 35;
  }

  // These terms overwhelmingly indicate user-made derivative/video-game
  // uploads rather than the release requested from Spotify.
  if (/beatsaber|beat saber|音ゲー|rhythmgame|gameplay|playthrough|プレイ動画/.test(`${candidate.title} ${candidate.uploader}`.toLocaleLowerCase())) score -= 180;
  if (/cover|歌ってみた|fanmade|fan made|二次創作|nightcore|8d audio|slowed|sped up|mashup|remix/.test(`${candidate.title} ${candidate.uploader}`.toLocaleLowerCase())) score -= 100;
  if (/karaoke|instrumental|piano|guitar|drum cover/.test(`${candidate.title} ${candidate.uploader}`.toLocaleLowerCase())) score -= 80;
  return score;
}

function parseSearchIds(output: string): string[] {
  return [...new Set(output
    .split(/\r?\n/)
    .map((line) => line.split('\t', 1)[0])
    .filter((id) => VIDEO_ID_PATTERN.test(id)))];
}

async function fetchYouTubeMetadata(videoId: string): Promise<YouTubeMetadata | null> {
  const { stdout } = await execFileAsync(
    getYtDlpCommand(),
    [
      '--encoding', 'utf-8', '--no-playlist', '--no-warnings', '--skip-download',
      '--print', '%(id)s\t%(title)s\t%(uploader)s\t%(thumbnail)s\t%(duration)s',
      `https://music.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 },
  );
  const [id, title, uploader, thumbnail, duration] = stdout.trim().split('\t', 5);
  if (!id || !VIDEO_ID_PATTERN.test(id)) return null;
  const parsedDuration = Number(duration);
  return {
    id, title: title || '', uploader: uploader || '', thumbnail: thumbnail || '',
    duration: Number.isFinite(parsedDuration) ? parsedDuration : null,
  };
}

/**
 * Find a video candidate with yt-dlp.  YouTube Music does not provide an
 * `ytmsearch` extractor in every yt-dlp release, so that candidate searches
 * the actual music.youtube.com results page instead.
 */
async function findYouTubeCandidate(
  url: string,
  title: string,
  artist: string,
  candidateType: 'youtube' | 'youtubeMusic',
  sourceService: MusicServiceType,
  expectedDuration: number | null,
  debugLog?: TrackResolverDebugLogger,
  searchQueryOverride?: string,
): Promise<TrackSearchCandidate[]> {
  const isYouTubeMusic = candidateType === 'youtubeMusic';
  const searchQuery = searchQueryOverride?.trim() || buildSearchQuery(artist, title);
  const query = isYouTubeMusic
    ? `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery)}`
    : `ytsearch12:${searchQuery} official`;
  try {
    const searchArgs = [
      '--encoding', 'utf-8',
      '--no-playlist', '--no-warnings', '--skip-download', '--flat-playlist',
      '--print', '%(id)s\t%(title)s', query,
    ];
    debugLog?.({
      stage: 'yt-dlp-command', sourceUrl: url, candidateType, searchQuery, ytDlpArgs: searchArgs,
    });
    const { stdout: searchOutput } = await execFileAsync(
      getYtDlpCommand(), searchArgs,
      { timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 },
    );
    const videoIds = parseSearchIds(searchOutput).slice(0, 12);
    if (videoIds.length === 0) {
      logYtDlpFailure(
        `candidate=${isYouTubeMusic ? 'YouTube Music' : 'YouTube'}\n`
        + `sourceUrl=${url}\nquery=${query}\n`
        + 'reason=search returned no playable video IDs',
      );
      return [{ track: null, error: '検索結果の動画IDを取得できませんでした。' }];
    }
    const fetched = await Promise.all(videoIds.map(async (videoId) => {
      try { return await fetchYouTubeMetadata(videoId); } catch { return null; }
    }));
    const ranked = fetched
      .filter((candidate): candidate is YouTubeMetadata => candidate !== null)
      .map((candidate) => ({ candidate, score: scoreYouTubeCandidate(candidate, title, artist, expectedDuration) }))
      .sort((a, b) => b.score - a.score);
    // The highest-confidence official match appears first. The remaining
    // results are intentionally kept so a user can select an alternate
    // release (live version, remaster, etc.) or make use of an edited query.
    const candidates = ranked
      .slice(0, MAX_CANDIDATES_PER_SERVICE)
      .map(({ candidate }) => ({
        track: {
          id: generateId(),
          url,
          resolvedVideoId: candidate.id,
          title: candidate.title || title,
          artist: candidate.uploader || artist,
          thumbnailUrl: candidate.thumbnail || `https://i.ytimg.com/vi/${candidate.id}/hqdefault.jpg`,
          durationSeconds: candidate.duration,
          // The video ID is always played by YouTubePlayer.html, but preserve
          // the original service for the queue label and source-link action.
          service: sourceService,
        },
        error: null,
      }));
    return candidates.length > 0
      ? candidates
      : [{ track: null, error: '再生可能な候補が見つかりませんでした。' }];
  } catch (error) {
    const ytDlpError = error as YtDlpError;
    logYtDlpFailure(
      `candidate=${isYouTubeMusic ? 'YouTube Music' : 'YouTube'}\n`
      + `sourceUrl=${url}\nquery=${query}\n`
      + `reason=${ytDlpError.message || String(error)}\n`
      + `exitCode=${String(ytDlpError.code ?? 'unknown')}\n`
      + `killed=${String(ytDlpError.killed ?? false)} signal=${String(ytDlpError.signal ?? 'none')}\n`
      + `stderr=${ytDlpError.stderr?.trim() || '(empty)'}\n`
      + `stdout=${ytDlpError.stdout?.trim() || '(empty)'}`,
    );
    console.warn('[TrackResolver] yt-dlp lookup failed:', ytDlpError.message || error);
    return [{ track: null, error: '検索できませんでした。yt-dlp の導入とネットワークを確認してください。' }];
  }
}

// ---------------------------------------------------------------------------
// Service-specific resolvers
// ---------------------------------------------------------------------------

async function resolveYouTube(url: string): Promise<TrackResolutionResult> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return fallbackResult(url, MusicServiceType.YouTube);

  const apiUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  try {
    const { statusCode, body } = await makeRequest(apiUrl);
    if (statusCode < 200 || statusCode >= 300) {
      return {
        id: generateId(), url, resolvedVideoId: videoId,
        title: 'YouTube Video', artist: 'Unknown Artist',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSeconds: null, service: MusicServiceType.YouTube,
      };
    }
    const data = JSON.parse(body);
    return {
      id: generateId(),
      url,
      resolvedVideoId: videoId,
      title: data.title || 'Unknown Track',
      artist: data.author_name || 'Unknown Artist',
      thumbnailUrl: data.thumbnail_url || '',
      durationSeconds: null, // oembed does not provide duration
      service: MusicServiceType.YouTube,
    };
  } catch {
    return {
      id: generateId(), url, resolvedVideoId: videoId,
      title: 'YouTube Video', artist: 'Unknown Artist',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSeconds: null, service: MusicServiceType.YouTube,
    };
  }
}

function extractSpotifyTrackId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const trackIndex = segments.indexOf('track');
    const trackId = trackIndex >= 0 ? segments[trackIndex + 1] : null;
    return trackId && /^[A-Za-z0-9]{22}$/.test(trackId) ? trackId : null;
  } catch {
    return null;
  }
}

interface SpotifyCatalogMetadata {
  title?: unknown;
  artist?: unknown;
  thumbnailUrl?: unknown;
  durationSeconds?: unknown;
}

/** Resolve Spotify metadata through the server's Client Credentials token. */
async function resolveSpotify(
  url: string,
  debugLog?: TrackResolverDebugLogger,
): Promise<TrackResolutionResult> {
  const trackId = extractSpotifyTrackId(url);
  if (!trackId) {
    debugLog?.({
      stage: 'spotify-web-api', sourceUrl: url,
      details: { error: 'Spotify track ID could not be extracted from URL' },
    });
    return { error: 'Spotify のトラック URL を認識できませんでした。', url };
  }

  const apiUrl = `${MUSIC_SHARE_SERVER_URL}/api/spotify/tracks/${trackId}`;
  try {
    const { statusCode, body } = await makeRequest(apiUrl);
    if (statusCode < 200 || statusCode >= 300) {
      debugLog?.({
        stage: 'spotify-web-api', sourceUrl: url,
        details: { trackId, statusCode, error: 'MusicShare Spotify catalog request failed' },
      });
      return { error: 'Spotify の曲情報を取得できませんでした。しばらくしてから再試行してください。', url };
    }

    const data = JSON.parse(body) as SpotifyCatalogMetadata;
    if (typeof data.title !== 'string' || typeof data.artist !== 'string'
      || typeof data.thumbnailUrl !== 'string'
      || (data.durationSeconds !== null && typeof data.durationSeconds !== 'number')) {
      throw new Error('MusicShare server returned invalid Spotify metadata');
    }
    const title = data.title.trim() || 'Unknown Track';
    const artist = data.artist.trim() || 'Unknown Artist';
    const thumbnailUrl = data.thumbnailUrl;
    const durationSeconds = data.durationSeconds;

    debugLog?.({
      stage: 'spotify-web-api', sourceUrl: url, title, artist,
      details: { trackId, statusCode, hasThumbnail: Boolean(thumbnailUrl) },
    });
    return {
      id: generateId(), url, resolvedVideoId: null, title, artist, thumbnailUrl,
      durationSeconds, service: MusicServiceType.Spotify,
    };
  } catch (error) {
    debugLog?.({
      stage: 'spotify-web-api', sourceUrl: url,
      details: { trackId, error: error instanceof Error ? error.message : String(error) },
    });
    return { error: 'Spotify API との通信中に曲情報を取得できませんでした。', url };
  }
}

async function resolveAppleMusic(url: string): Promise<TrackResolutionResult> {
  try {
    const { statusCode, body } = await makeRequest(url);
    if (statusCode < 200 || statusCode >= 300) {
      return fallbackResult(url, MusicServiceType.AppleMusic);
    }

    // Extract og:title and og:image via regex (no external parser dependency)
    const titleMatch = body.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    ) || body.match(
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i,
    );

    const imageMatch = body.match(
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    ) || body.match(
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i,
    );

    const rawTitle = titleMatch ? titleMatch[1].trim() : 'Unknown Track';
    // Apple Music og:title often contains "Song Title by Artist on Apple Music"
    let title = rawTitle;
    let artist = 'Unknown Artist';
    const byIdx = rawTitle.indexOf(' by ');
    const onIdx = rawTitle.lastIndexOf(' on Apple Music');
    if (byIdx > 0) {
      title = rawTitle.slice(0, byIdx).trim();
      artist = onIdx > byIdx
        ? rawTitle.slice(byIdx + 4, onIdx).trim()
        : rawTitle.slice(byIdx + 4).trim();
    }

    return {
      id: generateId(),
      url,
      resolvedVideoId: null,
      title,
      artist,
      thumbnailUrl: imageMatch ? imageMatch[1].trim() : '',
      durationSeconds: null,
      service: MusicServiceType.AppleMusic,
    };
  } catch {
    return fallbackResult(url, MusicServiceType.AppleMusic);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function resolveTrack(
  url: string,
  debugLog?: TrackResolverDebugLogger,
  options?: TrackResolveOptions,
  onYouTubeMusicCandidates?: YouTubeMusicCandidatesListener,
): Promise<TrackSearchResult> {
  const requestId = generateId();
  try {
    new URL(url); // validate URL format
  } catch {
    const error = 'URLの形式が正しくありません。';
    return {
      requestId,
      searchQuery: options?.searchQuery?.trim() || '',
      youtube: [{ track: null, error }],
      youtubeMusic: [{ track: null, error }],
    };
  }

  const service = detectService(url);

  const metadata = getCached(metadataCache, normalizeUrlCacheKey(url), async () => {
    const resolved = await (async (): Promise<TrackResolutionResult> => {
      switch (service) {
      case MusicServiceType.YouTube:
        return await resolveYouTube(url);
      case MusicServiceType.Spotify:
        return await resolveSpotify(url, debugLog);
      case MusicServiceType.AppleMusic:
        return await resolveAppleMusic(url);
      case MusicServiceType.DirectVideo:
        return resolveDirectVideo(url);
      default:
        return fallbackResult(url, service);
      }
    })();
    if ('error' in resolved || resolved.isFallback) {
      throw new Error('Track metadata could not be resolved');
    }
    return resolved;
  });

  let result: ResolvedTrack;
  try {
    result = metadata.value || await metadata.promise;
  } catch {
    return {
      requestId,
      searchQuery: options?.searchQuery?.trim() || '',
      youtube: [{ track: null, error: '曲情報を取得できませんでした。URLを確認してください。' }],
      youtubeMusic: [{ track: null, error: '曲情報を取得できませんでした。URLを確認してください。' }],
    };
  }

  if (service === MusicServiceType.Spotify) {
    debugLog?.({
      stage: 'spotify-metadata',
      sourceUrl: url,
      title: result.title,
      artist: result.artist,
      titleCodePoints: toCodePoints(result.title),
      artistCodePoints: toCodePoints(result.artist),
    });
  }

  const searchQuery = options?.searchQuery?.trim() || buildSearchQuery(result.artist, result.title);

  if (service === MusicServiceType.DirectVideo) {
    return {
      requestId,
      searchQuery,
      youtube: [{ track: result, error: null }],
      youtubeMusic: [],
    };
  }

  // A YouTube URL already identifies exactly what the user wants to play.
  // Do not search for lookalikes: present the linked video as the sole
  // YouTube candidate, with its video ID ready for direct playback.
  if (service === MusicServiceType.YouTube && result.resolvedVideoId) {
    return {
      requestId,
      searchQuery,
      youtube: [{ track: result, error: null }],
      youtubeMusic: [],
    };
  }

  const candidateKey = `${normalizeUrlCacheKey(url)}\u0000${normalizeCacheKey(searchQuery)}`;
  const youtubeLookup = getCached(candidateCache, `youtube\u0000${candidateKey}`, () => (
    findYouTubeCandidate(url, result.title, result.artist, 'youtube', service, result.durationSeconds, debugLog, searchQuery)
  ));
  const youtube = youtubeLookup.value || await youtubeLookup.promise;

  // Start the slower YouTube Music lookup only after the first candidates are
  // usable. A warm cache is returned immediately; otherwise the renderer is
  // notified when its background lookup completes.
  const musicLookup = getCached(candidateCache, `youtubeMusic\u0000${candidateKey}`, () => (
    findYouTubeCandidate(url, result.title, result.artist, 'youtubeMusic', service, result.durationSeconds, debugLog, searchQuery)
  ));
  if (musicLookup.value) {
    return { requestId, searchQuery, youtube, youtubeMusic: musicLookup.value };
  }
  void musicLookup.promise.then((youtubeMusic) => {
    onYouTubeMusicCandidates?.({ requestId, youtubeMusic });
  }).catch((error: unknown) => {
    console.warn('[TrackResolver] Deferred YouTube Music lookup failed:', error);
    onYouTubeMusicCandidates?.({
      requestId,
      youtubeMusic: [{ track: null, error: 'YouTube Music の候補を取得できませんでした。' }],
    });
  });
  return { requestId, searchQuery, youtube, youtubeMusic: [] };
}

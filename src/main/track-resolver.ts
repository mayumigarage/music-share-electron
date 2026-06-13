/**
 * MusicShare — Track Resolver
 * Phase 3.12–3.16: Resolve track URLs to metadata using Node.js https/fetch
 * to avoid CORS issues in the renderer.
 */

import * as https from 'https';
import { URL } from 'url';
import type {
  TrackResolutionResult,
  ResolvedTrack,
  TrackResolutionError,
} from '../shared/preload-api';
import { MusicServiceType } from '../shared/models';

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
  // Default fallback so we still return a result
  return MusicServiceType.YouTube;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function fallbackResult(url: string, service: MusicServiceType): ResolvedTrack {
  return {
    id: generateId(),
    url,
    title: 'Unknown Track',
    artist: 'Unknown Artist',
    thumbnailUrl: '',
    durationSeconds: null,
    service,
    isFallback: true,
  };
}

// ---------------------------------------------------------------------------
// Service-specific resolvers
// ---------------------------------------------------------------------------

async function resolveYouTube(url: string): Promise<TrackResolutionResult> {
  const apiUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  try {
    const { statusCode, body } = await makeRequest(apiUrl);
    if (statusCode < 200 || statusCode >= 300) {
      return fallbackResult(url, MusicServiceType.YouTube);
    }
    const data = JSON.parse(body);
    return {
      id: generateId(),
      url,
      title: data.title || 'Unknown Track',
      artist: data.author_name || 'Unknown Artist',
      thumbnailUrl: data.thumbnail_url || '',
      durationSeconds: null, // oembed does not provide duration
      service: MusicServiceType.YouTube,
    };
  } catch {
    return fallbackResult(url, MusicServiceType.YouTube);
  }
}

async function resolveSpotify(url: string): Promise<TrackResolutionResult> {
  const apiUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  try {
    const { statusCode, body } = await makeRequest(apiUrl);
    if (statusCode < 200 || statusCode >= 300) {
      return await resolveSpotifyFallback(url);
    }
    const data = JSON.parse(body);
    const title = data.title || 'Unknown Track';
    let artist = data.author_name || '';

    // oEmbed may return a generic or empty author_name; fall back to page scraping
    // when the artist looks unreliable.
    if (!artist || artist === 'Spotify' || artist === 'Unknown Artist' || artist === title) {
      const fallback = await resolveSpotifyFallback(url, title);
      if (fallback && 'artist' in fallback && fallback.artist && fallback.artist !== 'Unknown Artist') {
        artist = fallback.artist;
      }
    }

    return {
      id: generateId(),
      url,
      title,
      artist: artist || 'Unknown Artist',
      thumbnailUrl: data.thumbnail_url || '',
      durationSeconds: null, // oembed does not provide duration
      service: MusicServiceType.Spotify,
    };
  } catch {
    return await resolveSpotifyFallback(url);
  }
}

async function resolveSpotifyFallback(url: string, knownTitle?: string): Promise<TrackResolutionResult> {
  try {
    const { statusCode, body } = await makeRequest(url);
    if (statusCode < 200 || statusCode >= 300) {
      return fallbackResult(url, MusicServiceType.Spotify);
    }

    const titleMatch =
      body.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      body.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i);

    const imageMatch =
      body.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      body.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);

    const descMatch =
      body.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      body.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["'][^>]*>/i);

    const musicianMatch =
      body.match(/<meta[^>]*property=["']music:musician["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      body.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']music:musician["'][^>]*>/i);

    const twitterArtistMatch =
      body.match(/<meta[^>]*name=["']twitter:audio:artist_name["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      body.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:audio:artist_name["'][^>]*>/i);

    const rawTitle = knownTitle || (titleMatch ? titleMatch[1].trim() : 'Unknown Track');
    let title = rawTitle;
    let artist = 'Unknown Artist';

    // Prefer structured musician metadata when available
    if (twitterArtistMatch) {
      artist = twitterArtistMatch[1].trim();
    } else if (musicianMatch) {
      // music:musician is often a URL; try to extract the last path segment
      const musicianUrl = musicianMatch[1].trim();
      const nameDecoded = decodeURIComponent(musicianUrl.split('/').pop() || '');
      artist = nameDecoded.replace(/[_-]/g, ' ') || 'Unknown Artist';
    }

    // og:description often contains "Artist · Song · Album" or similar
    if (artist === 'Unknown Artist' && descMatch) {
      const desc = descMatch[1].trim();
      const parts = desc.split(/[·•|-]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        artist = parts[0];
      }
    }

    // og:title sometimes contains "Song by Artist"
    const byIdx = rawTitle.indexOf(' by ');
    if (byIdx > 0) {
      title = rawTitle.slice(0, byIdx).trim();
      if (artist === 'Unknown Artist') {
        artist = rawTitle.slice(byIdx + 4).trim();
      }
    }

    return {
      id: generateId(),
      url,
      title,
      artist,
      thumbnailUrl: imageMatch ? imageMatch[1].trim() : '',
      durationSeconds: null,
      service: MusicServiceType.Spotify,
    };
  } catch {
    return fallbackResult(url, MusicServiceType.Spotify);
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

// ---------------------------------------------------------------------------
// Spotify → YouTube conversion (individual mode)
// ---------------------------------------------------------------------------

async function searchYouTubeByQuery(query: string): Promise<string | null> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  try {
    // Pass a consent cookie to skip the GDPR interstitial
    const { statusCode, body } = await makeRequest(searchUrl, {
      Cookie: 'CONSENT=YES+cb',
      'Accept-Language': 'en-US,en;q=0.9',
    });
    if (statusCode < 200 || statusCode >= 300) return null;

    // Extract ytInitialData JSON blob
    const startMarker = 'var ytInitialData = ';
    const startIdx = body.indexOf(startMarker);
    if (startIdx === -1) return null;

    const jsonStart = startIdx + startMarker.length;
    const endIdx = body.indexOf(';</script>', jsonStart);
    if (endIdx === -1) return null;

    const data = JSON.parse(body.slice(jsonStart, endIdx));
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (!Array.isArray(contents)) return null;

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const videoId = item?.videoRenderer?.videoId;
        if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert a Spotify track URL to an equivalent YouTube watch URL.
 * 1. Resolve Spotify metadata (title / artist).
 * 2. Search YouTube for "artist title".
 * 3. Return the first video result, or null on failure.
 */
export async function convertSpotifyToYouTube(url: string): Promise<string | null> {
  const spotifyResult = await resolveSpotify(url);
  if ('error' in spotifyResult || spotifyResult.isFallback) return null;

  const query = `${spotifyResult.artist} ${spotifyResult.title}`;
  return searchYouTubeByQuery(query);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function resolveTrack(url: string): Promise<TrackResolutionResult> {
  try {
    new URL(url); // validate URL format
  } catch {
    return { error: 'Invalid URL format', url };
  }

  const service = detectService(url);

  switch (service) {
    case MusicServiceType.YouTube:
      return resolveYouTube(url);
    case MusicServiceType.Spotify:
      return resolveSpotify(url);
    case MusicServiceType.AppleMusic:
      return resolveAppleMusic(url);
    default:
      return fallbackResult(url, service);
  }
}

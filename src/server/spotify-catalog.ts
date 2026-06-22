/**
 * Server-side Spotify catalog access.
 *
 * The client secret intentionally exists only in this process. Electron
 * clients receive metadata, never Spotify access tokens or credentials.
 */
import * as https from 'https';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_TRACK_API_URL = 'https://api.spotify.com/v1/tracks/';
const TOKEN_REFRESH_SKEW_MS = 60_000;

interface SpotifyTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface SpotifyTrackResponse {
  name?: string;
  artists?: Array<{ name?: string }>;
  album?: { images?: Array<{ url?: string }> };
  duration_ms?: number;
}

export interface SpotifyTrackMetadata {
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
}

let cachedAccessToken: string | null = null;
let accessTokenExpiresAt = 0;
let pendingAccessToken: Promise<string> | null = null;

function request(
  url: string,
  options: https.RequestOptions,
  body?: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, options, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { responseBody += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: responseBody }));
    });
    request.on('error', reject);
    request.setTimeout(10_000, () => request.destroy(new Error('Spotify request timed out')));
    if (body) request.write(body);
    request.end();
  });
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - TOKEN_REFRESH_SKEW_MS) {
    return cachedAccessToken;
  }
  if (pendingAccessToken) return pendingAccessToken;

  pendingAccessToken = (async () => {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Spotify server credentials are not configured');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = 'grant_type=client_credentials';
    const result = await request(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`Spotify token request failed (${result.statusCode})`);
    }

    const token = JSON.parse(result.body) as SpotifyTokenResponse;
    const expiresIn = token.expires_in;
    if (!token.access_token || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) {
      throw new Error('Spotify token response was invalid');
    }
    cachedAccessToken = token.access_token;
    accessTokenExpiresAt = Date.now() + expiresIn * 1000;
    return cachedAccessToken;
  })().finally(() => { pendingAccessToken = null; });

  return pendingAccessToken;
}

async function fetchTrack(trackId: string, retryOnUnauthorized: boolean): Promise<SpotifyTrackResponse> {
  const accessToken = await getAccessToken();
  const result = await request(`${SPOTIFY_TRACK_API_URL}${encodeURIComponent(trackId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (result.statusCode === 401 && retryOnUnauthorized) {
    cachedAccessToken = null;
    accessTokenExpiresAt = 0;
    return fetchTrack(trackId, false);
  }
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Spotify track request failed (${result.statusCode})`);
  }
  return JSON.parse(result.body) as SpotifyTrackResponse;
}

export async function getSpotifyTrackMetadata(trackId: string): Promise<SpotifyTrackMetadata> {
  const track = await fetchTrack(trackId, true);
  const artist = track.artists
    ?.map((entry) => entry.name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(', ') || 'Unknown Artist';
  return {
    title: track.name?.trim() || 'Unknown Track',
    artist,
    thumbnailUrl: track.album?.images?.find((image) => Boolean(image.url))?.url || '',
    durationSeconds: Number.isFinite(track.duration_ms) ? Math.round(track.duration_ms! / 1000) : null,
  };
}

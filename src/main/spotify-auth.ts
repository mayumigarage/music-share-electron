/**
 * MusicShare — Spotify Authentication Manager
 * Phase 5: OAuth 2.0 Authorization Code + PKCE flow for Spotify Web Playback SDK.
 *
 * Responsibilities:
 * - Generate PKCE code verifier / challenge
 * - Build the Spotify authorization URL
 * - Exchange authorization code for tokens
 * - Refresh access tokens automatically
 * - Provide a valid access token on demand
 * - Persist the refresh token securely using Electron safeStorage
 */

import * as https from 'https';
import * as crypto from 'crypto';
import * as querystring from 'querystring';
import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';
import type { SpotifyTokenSet } from '../shared/models';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REDIRECT_URI = 'musicshare://spotify/callback';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
];

/**
 * Spotify public client ID.  It is deliberately compiled into the main
 * process bundle so packaged builds do not depend on a developer shell's
 * environment variables.
 */
const CLIENT_ID = '89117343229b4ba5935320d2fb41673d';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function sha256(buffer: string): Buffer {
  return crypto.createHash('sha256').update(buffer).digest();
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64URLEncode(crypto.randomBytes(32));
  const challenge = base64URLEncode(sha256(verifier));
  return { verifier, challenge };
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token: string;
}

function httpsPost(
  urlString: string,
  postData: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      urlString,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
      },
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// SpotifyAuthManager
// ---------------------------------------------------------------------------

export class SpotifyAuthManager {
  private tokenSet: SpotifyTokenSet | null = null;
  private codeVerifier: string | null = null;
  private pendingAuthResolve: ((value: { success: boolean; error?: string }) => void) | null = null;
  /** Deduplicates concurrent refresh requests so only one HTTP call is made. */
  private refreshPromise: Promise<boolean> | null = null;
  /** Whether stored tokens have been loaded from disk. */
  private initialized = false;

  /**
   * Initialize the auth manager by loading any previously stored refresh token.
   * Must be called after `app.whenReady()` because safeStorage is not available
   * before the app is ready.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadStoredTokens();
    this.initialized = true;
  }

  /**
   * Build the Spotify authorization URL and return it.
   * The caller should open this URL in the user's browser.
   */
  startAuth(): { authUrl: string } {
    if (!CLIENT_ID) {
      throw new Error(
        'Spotify Client ID is not configured.',
      );
    }

    const { verifier, challenge } = generatePKCE();
    this.codeVerifier = verifier;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: SCOPES.join(' '),
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });

    const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
    return { authUrl };
  }

  /**
   * Complete the authorization flow by exchanging the code for tokens.
   * This should be called when the `open-url` event fires with the callback.
   */
  async completeAuth(callbackUrl: string): Promise<{ success: boolean; error?: string }> {
    if (!this.codeVerifier) {
      return { success: false, error: 'No pending authorization request' };
    }

    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      this.codeVerifier = null;
      return { success: false, error: `Spotify authorization denied: ${error}` };
    }

    if (!code) {
      this.codeVerifier = null;
      return { success: false, error: 'No authorization code in callback URL' };
    }

    try {
      const postData = querystring.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: this.codeVerifier,
      });

      const { statusCode, body } = await httpsPost(SPOTIFY_TOKEN_URL, postData);

      if (statusCode < 200 || statusCode >= 300) {
        this.codeVerifier = null;
        return { success: false, error: `Token exchange failed (${statusCode}): ${body}` };
      }

      const data = JSON.parse(body) as TokenResponse;
      this.tokenSet = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
      this.codeVerifier = null;
      await this.saveTokens();

      return { success: true };
    } catch (err) {
      this.codeVerifier = null;
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Token exchange error: ${message}` };
    }
  }

  /**
   * Refresh the access token using the stored refresh token.
   */
  async refreshAccessToken(): Promise<boolean> {
    if (!this.tokenSet) {
      return false;
    }

    try {
      const postData = querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.tokenSet.refreshToken,
        client_id: CLIENT_ID,
      });

      const { statusCode, body } = await httpsPost(SPOTIFY_TOKEN_URL, postData);

      if (statusCode < 200 || statusCode >= 300) {
        console.error('[SpotifyAuth] Refresh failed:', statusCode, body);
        // Clear tokens on persistent refresh failure so the UI can re-authenticate
        this.clearTokens();
        return false;
      }

      const data = JSON.parse(body) as Omit<TokenResponse, 'refresh_token'> & {
        refresh_token?: string;
      };

      this.tokenSet = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || this.tokenSet.refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
      await this.saveTokens();

      return true;
    } catch (err) {
      console.error('[SpotifyAuth] Refresh error:', err);
      this.clearTokens();
      return false;
    }
  }

  /**
   * Get a valid access token, automatically refreshing if within
   * 60 seconds of expiry.
   */
  async getValidAccessToken(): Promise<string | null> {
    if (!this.tokenSet) {
      return null;
    }

    const refreshThreshold = 60 * 1000; // 60 seconds before expiry
    if (Date.now() + refreshThreshold >= this.tokenSet.expiresAt) {
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshAccessToken().finally(() => {
          this.refreshPromise = null;
        });
      }
      const ok = await this.refreshPromise;
      if (!ok) {
        return null;
      }
    }

    return this.tokenSet.accessToken;
  }

  /**
   * Return the current token set (for inspection / broadcasting).
   */
  getTokenSet(): SpotifyTokenSet | null {
    return this.tokenSet;
  }

  /**
   * Clear the stored tokens (e.g., on sign-out).
   */
  clearTokens(): void {
    this.tokenSet = null;
    this.codeVerifier = null;
    this.clearStoredTokens();
  }

  /**
   * Inject an access token directly (development/testing only).
   * This bypasses the OAuth flow. The token is kept in-memory only.
   */
  injectToken(accessToken: string, expiresInSeconds = 3600): void {
    this.tokenSet = {
      accessToken,
      refreshToken: '', // No refresh token for injected tokens
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };
  }

  // -------------------------------------------------------------------------
  // SafeStorage persistence (private)
  // -------------------------------------------------------------------------

  private getTokenFilePath(): string {
    return path.join(app.getPath('userData'), 'spotify-auth.json');
  }

  private async loadStoredTokens(): Promise<void> {
    const tokenFile = this.getTokenFilePath();
    if (!fs.existsSync(tokenFile)) {
      return;
    }

    try {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('[SpotifyAuth] safeStorage encryption not available; skipping token load');
        return;
      }

      const encrypted = fs.readFileSync(tokenFile);
      const json = safeStorage.decryptString(encrypted);
      const data = JSON.parse(json) as { refreshToken: string };

      if (data.refreshToken) {
        this.tokenSet = {
          accessToken: '', // Will be refreshed on first use
          refreshToken: data.refreshToken,
          expiresAt: 0, // Force refresh on first use
        };
        console.log('[SpotifyAuth] Loaded stored refresh token');
      }
    } catch (err) {
      console.error('[SpotifyAuth] Failed to load stored tokens:', err);
      // Don't throw; just start unauthenticated
    }
  }

  private async saveTokens(): Promise<void> {
    if (!this.tokenSet?.refreshToken) {
      return;
    }

    try {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('[SpotifyAuth] safeStorage encryption not available; skipping token save');
        return;
      }

      const json = JSON.stringify({ refreshToken: this.tokenSet.refreshToken });
      const encrypted = safeStorage.encryptString(json);
      fs.writeFileSync(this.getTokenFilePath(), encrypted);
    } catch (err) {
      console.error('[SpotifyAuth] Failed to save tokens:', err);
    }
  }

  private clearStoredTokens(): void {
    try {
      const tokenFile = this.getTokenFilePath();
      if (fs.existsSync(tokenFile)) {
        fs.unlinkSync(tokenFile);
      }
    } catch (err) {
      console.error('[SpotifyAuth] Failed to clear stored tokens:', err);
    }
  }
}

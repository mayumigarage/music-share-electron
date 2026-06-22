/**
 * MusicShare — Preload API Type Definitions
 * Phase 1: Electron contextBridge API interface
 *
 * These types define the contract between:
 * - Main Process (Electron)
 * - Preload Script (contextBridge)
 * - Renderer Process (UI)
 *
 * Constraints:
 * - nodeIntegration: false
 * - contextIsolation: true
 */

import type { MusicServiceType } from './models';

// ============================================================================
// Player Message Types
// ============================================================================

/** Messages emitted by the DOM-hosted player. */
export type PlayerMessage =
  | { type: 'ready' }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'ended' }
  | { type: 'stopped' }
  | { type: 'error'; error: string }
  | { type: 'warning'; warning: string }
  | { type: 'duration'; durationSeconds: number }
  | { type: 'timeUpdate'; currentTimeSeconds: number }
  | { type: 'state'; isPlaying: boolean; currentTime: number; duration: number; trackInfo?: { title: string; artist: string; thumbnailUrl: string } }
  | { type: 'loaded'; uri: string }
  | { type: 'buffering'; isBuffering: boolean };

// ============================================================================
// Track Resolution Types
// ============================================================================

/** Result of resolving a track URL to metadata */
export interface ResolvedTrack {
  id: string;
  url: string;
  /** YouTube/YouTube Music video selected for playback. */
  resolvedVideoId: string | null;
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  service: MusicServiceType;
  /** True when metadata could not be fetched and a fallback result is returned */
  isFallback?: boolean;
}

/** Error result when track resolution fails */
export interface TrackResolutionError {
  error: string;
  url: string;
}

export type TrackResolutionResult = ResolvedTrack | TrackResolutionError;

/** A playback candidate shown in the add-track dialog. */
export interface TrackSearchCandidate {
  track: ResolvedTrack | null;
  error: string | null;
}

/** Options for changing the keyword used when looking up playback candidates. */
export interface TrackResolveOptions {
  /**
   * A user-edited search phrase. This is passed as data to yt-dlp, never
   * executed as a shell command.
   */
  searchQuery?: string;
}

/** YouTube and YouTube Music candidates derived from one submitted URL. */
export interface TrackSearchResult {
  /** Identifies this lookup when delayed YouTube Music candidates arrive. */
  requestId: string;
  /** The normalized query generated from URL metadata. */
  searchQuery: string;
  youtube: TrackSearchCandidate[];
  youtubeMusic: TrackSearchCandidate[];
}

/** YouTube Music candidates delivered after the initial YouTube result. */
export interface YouTubeMusicCandidatesResult {
  requestId: string;
  youtubeMusic: TrackSearchCandidate[];
}

/**
 * Diagnostic information emitted while resolving an external track URL.
 * This is intentionally limited to metadata and yt-dlp arguments; no tokens
 * or other credentials are included.
 */
export interface TrackResolverDebugLog {
  stage: 'spotify-web-api' | 'spotify-metadata' | 'yt-dlp-command';
  sourceUrl: string;
  candidateType?: 'youtube' | 'youtubeMusic';
  title?: string;
  artist?: string;
  titleCodePoints?: string[];
  artistCodePoints?: string[];
  searchQuery?: string;
  ytDlpArgs?: string[];
  /** Non-sensitive request/parsing context for troubleshooting metadata lookups. */
  details?: Record<string, string | number | boolean | null>;
}

// ============================================================================
// Electron API Interface
// ============================================================================

/**
 * The API exposed to the renderer process via contextBridge.
 *
 * Usage in renderer:
 *   window.electronAPI.openExternal('https://example.com');
 */
export interface ElectronAPI {
  /** Update side-panel state in the main process. */
  setSidebarVisibility: (leftVisible: boolean, rightVisible: boolean) => Promise<void>;

  /**
   * Open a URL in the default system browser.
   * Used for external links (e.g., opening a track on YouTube/Spotify).
   * @param url - The URL to open
   */
  openExternal: (url: string) => Promise<void>;

  /**
   * Resolve a track URL to its metadata.
   * This runs in the main process to avoid CORS issues in the renderer.
   * @param url - The track URL to resolve
   * @returns The resolved track metadata or an error
   */
  resolveTrack: (url: string, options?: TrackResolveOptions) => Promise<TrackSearchResult>;

  /**
   * Subscribe to metadata and yt-dlp command diagnostics emitted during
   * external-link resolution. Intended for the DevTools Console.
   */
  onTrackResolverDebug: (callback: (log: TrackResolverDebugLog) => void) => () => void;

  /** Subscribe to YouTube Music candidates that complete after URL resolution. */
  onYouTubeMusicCandidates: (callback: (result: YouTubeMusicCandidatesResult) => void) => () => void;

  /**
   * Report a crash/uncaught error from the renderer to the main process
   * so it can be written to crash.log.
   */
  reportCrash: (detail: string) => void;

  /**
   * Show a fatal error dialog box (blocks renderer, user must acknowledge).
   * For non-fatal errors use in-renderer toast instead.
   */
  showErrorDialog: (title: string, message: string) => void;

  /**
   * Start the Spotify OAuth authorization flow (PKCE).
   * Opens the user's browser and waits for the callback.
   */
  startSpotifyAuth: () => Promise<{ success: boolean; error?: string }>;

  /**
   * Subscribe to Spotify access token updates.
   * Called when a token is obtained or refreshed.
   * @returns Unsubscribe function
   */
  onSpotifyToken: (callback: (token: string | null) => void) => () => void;

  /**
   * Get the current valid Spotify access token, or null if not authenticated.
   * Main process will automatically refresh if expired.
   */
  getSpotifyToken: () => Promise<string | null>;

  /**
   * Manually inject a Spotify access token (development/testing only).
   * Bypasses the OAuth flow. The token must include the `streaming` scope.
   */
  setSpotifyToken: (token: string) => Promise<void>;

  /**
   * Clear the Spotify authentication tokens (logout).
   */
  clearSpotifyAuth: () => Promise<void>;
}

// ============================================================================
// Window Interface Extension
// ============================================================================

/**
 * Extend the global Window interface to include our Electron API.
 * This allows TypeScript to recognize `window.electronAPI`.
 */
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Export empty object to make this a module
export {};

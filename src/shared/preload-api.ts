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

/** Commands that can be sent to the player */
export type PlayerCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; positionSeconds: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'loadTrack'; url: string; service: MusicServiceType }
  | { type: 'getDuration' }
  | { type: 'getCurrentTime' }
  | { type: 'getState' };

/** Messages received from the player */
export type PlayerMessage =
  | { type: 'ready' }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'ended' }
  | { type: 'stopped' }
  | { type: 'error'; error: string }
  | { type: 'duration'; durationSeconds: number }
  | { type: 'timeUpdate'; currentTimeSeconds: number }
  | { type: 'state'; isPlaying: boolean; currentTime: number; duration: number; trackInfo?: { title: string; artist: string; thumbnailUrl: string } }
  | { type: 'buffering'; isBuffering: boolean };

// ============================================================================
// Track Resolution Types
// ============================================================================

/** Result of resolving a track URL to metadata */
export interface ResolvedTrack {
  id: string;
  url: string;
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
  /**
   * Subscribe to messages from the player (WebContentsView).
   * @param callback - Function to handle player messages
   * @returns Unsubscribe function
   */
  onPlayerMessage: (callback: (message: PlayerMessage) => void) => () => void;

  /**
   * Send a command to the player (WebContentsView).
   * @param command - The command to send
   */
  sendToPlayer: (command: PlayerCommand) => void;

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
  resolveTrack: (url: string) => Promise<TrackResolutionResult>;

  /**
   * Convert a Spotify track URL to an equivalent YouTube watch URL.
   * Used in individual mode so Spotify links can still be played via the
   * YouTube player without requiring a Spotify Premium account or SDK token.
   * Returns null when the conversion fails.
   */
  convertSpotifyToYouTube: (url: string) => Promise<string | null>;

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
   * Get the desktop audio source ID for the MusicShare window.
   * Used by WebRTC host to capture the player audio via desktopCapturer.
   * Returns null if the source could not be found.
   */
  getDesktopAudioSource: () => Promise<{ id: string; name: string } | null>;

  /**
   * Send a WebRTC signaling message to the player WebContentsView.
   * Used by SyncEngine to relay SDP/ICE between the player and guests.
   */
  sendPlayerSignaling: (payload: unknown) => void;

  /**
   * Subscribe to WebRTC signaling messages coming from the player WebContentsView.
   * The player captures its own audio and manages RTCPeerConnections internally;
   * only signaling (SDP/ICE) crosses the process boundary.
   */
  onPlayerSignaling: (callback: (payload: unknown) => void) => () => void;

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
}

// ============================================================================
// Player Preload API Interface (for player WebContentsView)
// ============================================================================

/**
 * API exposed inside player HTML via player-preload.ts.
 * Player wrappers use this to send messages back to Main.
 */
export interface PlayerPreloadAPI {
  sendMessage: (msg: unknown) => void;
  getSpotifyToken: () => Promise<string | null>;
  onSpotifyToken: (callback: (token: string | null) => void) => () => void;
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
    electronPlayerAPI: PlayerPreloadAPI;
  }
}

// Export empty object to make this a module
export {};

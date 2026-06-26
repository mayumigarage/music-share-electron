/**
 * MusicShare — Preload Script
 * Phase 4: Secure IPC bridge between Main and Renderer.
 *
 * Uses contextBridge to expose a strictly typed API to the renderer.
 * All Node.js / Electron access is confined to this isolated preload context.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { AudioStreamMetadata, LocalAudioSearchResult } from '../shared/models';
import type {
  ElectronAPI,
  TrackResolverDebugLog,
  TrackSearchResult,
  YouTubeMusicCandidatesResult,
} from '../shared/preload-api';

const api: ElectronAPI = {
  setSidebarVisibility: (leftVisible, rightVisible) => {
    return ipcRenderer.invoke('set-sidebar-visibility', leftVisible, rightVisible) as Promise<void>;
  },

  /**
   * Open a URL in the system's default browser.
   */
  openExternal: (url: string) => {
    return ipcRenderer.invoke('open-external', url);
  },

  /**
   * Resolve a track URL to its metadata (runs in main process to avoid CORS).
   */
  resolveTrack: (url: string, options) => {
    return ipcRenderer.invoke('resolve-track', url, options) as Promise<TrackSearchResult>;
  },

  /**
   * Resolve a local media ID to audio metadata and a playback URL.
   */
  getAudioStream: (mediaId: string) => {
    return ipcRenderer.invoke('get-audio-stream', mediaId) as Promise<AudioStreamMetadata>;
  },

  /**
   * Search local audio tracks through the main process.
   */
  searchLocalAudioTracks: (query: string) => {
    return ipcRenderer.invoke('search-local-audio', query) as Promise<LocalAudioSearchResult[]>;
  },

  /** Subscribe to real-time track-resolution diagnostics from Main. */
  onTrackResolverDebug: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      log: TrackResolverDebugLog,
    ) => {
      callback(log);
    };
    ipcRenderer.on('track-resolver-debug', handler);
    return () => {
      ipcRenderer.removeListener('track-resolver-debug', handler);
    };
  },

  onYouTubeMusicCandidates: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: YouTubeMusicCandidatesResult,
    ) => {
      callback(result);
    };
    ipcRenderer.on('youtube-music-candidates', handler);
    return () => {
      ipcRenderer.removeListener('youtube-music-candidates', handler);
    };
  },

  /**
   * Report a crash from renderer so main can append it to crash.log.
   */
  reportCrash: (detail: string) => {
    ipcRenderer.invoke('report-crash', detail);
  },

  /**
   * Show a fatal-error dialog box from the main process.
   */
  showErrorDialog: (title: string, message: string) => {
    ipcRenderer.invoke('show-error-dialog', title, message);
  },

  /**
   * Start the Spotify OAuth authorization flow (PKCE).
   */
  startSpotifyAuth: () => {
    return ipcRenderer.invoke('start-spotify-auth') as Promise<{
      success: boolean;
      error?: string;
    }>;
  },

  /**
   * Subscribe to Spotify access token updates.
   */
  onSpotifyToken: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, token: string | null) => {
      callback(token);
    };
    ipcRenderer.on('spotify-token', handler);
    return () => {
      ipcRenderer.removeListener('spotify-token', handler);
    };
  },

  /**
   * Get the current valid Spotify access token.
   */
  getSpotifyToken: () => {
    return ipcRenderer.invoke('get-spotify-token') as Promise<string | null>;
  },

  /**
   * Manually inject a Spotify access token (development/testing only).
   */
  setSpotifyToken: (token: string) => {
    return ipcRenderer.invoke('set-spotify-token', token) as Promise<void>;
  },

  /**
   * Clear the Spotify authentication tokens (logout).
   */
  clearSpotifyAuth: () => {
    return ipcRenderer.invoke('clear-spotify-auth') as Promise<void>;
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

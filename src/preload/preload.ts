/**
 * MusicShare — Preload Script
 * Phase 4: Secure IPC bridge between Main and Renderer.
 *
 * Uses contextBridge to expose a strictly typed API to the renderer.
 * All Node.js / Electron access is confined to this isolated preload context.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  ElectronAPI,
  PlayerCommand,
  PlayerMessage,
  TrackResolutionResult,
} from '../shared/preload-api';

const api: ElectronAPI = {
  /**
   * Subscribe to player messages relayed from the WebContentsView.
   * Returns an unsubscribe function.
   */
  onPlayerMessage: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      message: PlayerMessage,
    ) => {
      callback(message);
    };
    ipcRenderer.on('player-message', handler);
    return () => {
      ipcRenderer.removeListener('player-message', handler);
    };
  },

  /**
   * Send a command to the player running inside the WebContentsView.
   */
  sendToPlayer: (command: PlayerCommand) => {
    ipcRenderer.invoke('send-to-player', command);
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
  resolveTrack: (url: string) => {
    return ipcRenderer.invoke('resolve-track', url) as Promise<TrackResolutionResult>;
  },

  /**
   * Convert a Spotify track URL to an equivalent YouTube watch URL.
   */
  convertSpotifyToYouTube: (url: string) => {
    return ipcRenderer.invoke('convert-spotify-to-youtube', url) as Promise<string | null>;
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
   * Get the desktop audio source ID for the MusicShare window.
   */
  getDesktopAudioSource: () => {
    return ipcRenderer.invoke('get-desktop-audio-source') as Promise<
      { id: string; name: string } | null
    >;
  },

  /**
   * Send a WebRTC signaling message to the player WebContentsView.
   */
  sendPlayerSignaling: (payload: unknown) => {
    ipcRenderer.send('send-player-signaling', payload);
  },

  /**
   * Subscribe to WebRTC signaling messages from the player WebContentsView.
   */
  onPlayerSignaling: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on('player-signaling', handler);
    return () => {
      ipcRenderer.removeListener('player-signaling', handler);
    };
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
};

contextBridge.exposeInMainWorld('electronAPI', api);

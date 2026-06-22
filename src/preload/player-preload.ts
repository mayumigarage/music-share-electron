/**
 * MusicShare — Player Preload Script
 * Phase 5: Secure IPC bridge for player WebContentsView.
 *
 * Constraints:
 * - nodeIntegration: false
 * - contextIsolation: true
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Player Message API (existing) ──

interface PlayerPreloadAPI {
  /** Send a structured message to the main process (PlayerBridge). */
  sendMessage: (msg: unknown) => void;
  /** Get the current valid Spotify access token. */
  getSpotifyToken: () => Promise<string | null>;
  /** Subscribe to Spotify access token updates. */
  onSpotifyToken: (callback: (token: string | null) => void) => () => void;
}

const playerApi: PlayerPreloadAPI = {
  sendMessage: (msg: unknown) => {
    ipcRenderer.send('player-message', msg);
  },
  getSpotifyToken: () => {
    return ipcRenderer.invoke('get-spotify-token') as Promise<string | null>;
  },
  onSpotifyToken: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, token: string | null) => {
      callback(token);
    };
    ipcRenderer.on('spotify-token', handler);
    return () => {
      ipcRenderer.removeListener('spotify-token', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronPlayerAPI', playerApi);

export {};

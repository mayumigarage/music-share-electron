/**
 * MusicShare — Player Bridge
 * Phase 3.8–3.11: WebContentsView management, player scripting,
 * message reception, and disposal to prevent memory leaks.
 */

import { WebContentsView, ipcMain, View } from 'electron';
import * as path from 'path';
import type { PlayerCommand, PlayerMessage } from '../shared/preload-api';
import { MusicServiceType } from '../shared/models';
import { getPlayerUrl } from './asset-path';

export class PlayerBridge {
  private view: WebContentsView;
  private parentView: View;
  private messageCallback?: (msg: PlayerMessage) => void;
  private signalingCallback?: (payload: unknown) => void;
  private isReady = false;
  private readyResolvers: Array<() => void> = [];

  constructor(parentView: View, service: MusicServiceType, playerServerUrl: string) {
    this.parentView = parentView;

    const playerPreloadPath = path.join(__dirname, '../preload/player-preload.js');

    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: playerPreloadPath,
        // Required for EME / Widevine CDM (Spotify Web Playback SDK).
        // NOTE: Electron standard builds may lack the Widevine CDM binaries,
        // so playback can still fail. The initialization_error listener in
        // PlayerProxy logs the exact SDK error for diagnosis.
        plugins: true,
      },
    });

    // Load the appropriate player wrapper HTML via local asset server
    const playerUrl = getPlayerUrl(service, playerServerUrl);
    this.view.webContents.loadURL(playerUrl);

    // Attach to the parent view (BaseWindow.contentView)
    parentView.addChildView(this.view);

    // Listen for player messages relayed via preload script
    ipcMain.on('player-message', this.onIpcMessage);
    // Phase 6.2: Listen for WebRTC signaling messages from the player preload
    ipcMain.on('player-signaling-out', this.onIpcSignalingMessage);
  }

  private onIpcMessage = (event: Electron.IpcMainEvent, data: unknown) => {
    // Ensure the message originated from this bridge's view
    if (event.sender !== this.view.webContents) return;
    if (typeof data !== 'object' || data === null) return;
    const msg = data as PlayerMessage;
    if (msg.type === 'ready') {
      this.isReady = true;
      this.readyResolvers.forEach((r) => r());
      this.readyResolvers = [];
    }
    this.messageCallback?.(msg);
  };

  private onIpcSignalingMessage = (event: Electron.IpcMainEvent, data: unknown) => {
    // Ensure the signaling message originated from this bridge's view
    if (event.sender !== this.view.webContents) return;
    this.signalingCallback?.(data);
  };

  /**
   * Subscribe to messages originating from the player HTML.
   */
  onPlayerMessage(callback: (msg: PlayerMessage) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Subscribe to WebRTC signaling messages originating from the player preload.
   */
  onPlayerSignaling(callback: (payload: unknown) => void): void {
    this.signalingCallback = callback;
  }

  /**
   * Wait until the player wrapper HTML emits a 'ready' message.
   */
  whenReady(): Promise<void> {
    if (this.isReady) return Promise.resolve();
    return new Promise((resolve) => {
      this.readyResolvers.push(resolve);
    });
  }

  /**
   * Send a WebRTC signaling message into the player preload.
   */
  sendSignaling(payload: unknown): void {
    if (this.view.webContents.isDestroyed()) return;
    this.view.webContents.send('player-signaling-in', payload);
  }

  /**
   * Send a command to the player by executing its global functions.
   */
  async sendCommand(command: PlayerCommand): Promise<void> {
    const wc = this.view.webContents;
    if (wc.isDestroyed()) return;

    switch (command.type) {
      case 'loadTrack': {
        await wc.executeJavaScript(
          `if (typeof playTrack === 'function') playTrack(${JSON.stringify(command.url)});`,
          true,
        );
        break;
      }
      case 'play': {
        await wc.executeJavaScript(
          `if (typeof resume === 'function') resume();`,
          true,
        );
        break;
      }
      case 'pause': {
        await wc.executeJavaScript(
          `if (typeof pause === 'function') pause();`,
          true,
        );
        break;
      }
      case 'stop': {
        await wc.executeJavaScript(
          `if (typeof stop === 'function') stop();`,
          true,
        );
        break;
      }
      case 'seek': {
        await wc.executeJavaScript(
          `if (typeof seek === 'function') seek(${command.positionSeconds});`,
          true,
        );
        break;
      }
      case 'setVolume': {
        await wc.executeJavaScript(
          `if (typeof setVolume === 'function') setVolume(${command.volume});`,
          true,
        );
        break;
      }
      case 'getDuration':
      case 'getCurrentTime':
      case 'getState': {
        // Player will push state updates; polling is optional
        break;
      }
    }
  }

  /**
   * Get the underlying WebContentsView for layout calculations.
   */
  getWebContentsView(): WebContentsView {
    return this.view;
  }

  /**
   * Cleanly destroy the player view to prevent memory leaks.
   */
  dispose(): void {
    // Remove IPC listeners first
    ipcMain.removeListener('player-message', this.onIpcMessage);
    ipcMain.removeListener('player-signaling-out', this.onIpcSignalingMessage);

    // Remove from parent view hierarchy
    try {
      this.parentView.removeChildView(this.view);
    } catch {
      // May already be removed
    }

    // Stop navigation and destroy the underlying webContents
    const wc = this.view.webContents;
    if (!wc.isDestroyed()) {
      // Allow the player HTML to run any service-specific cleanup (e.g. Spotify disconnect)
      try {
        wc.executeJavaScript(
          'if (typeof cleanupPlayer === "function") { try { cleanupPlayer(); } catch {} }',
          true,
        );
      } catch {
        // ignore
      }
      try {
        wc.stop();
      } catch {
        // ignore
      }
      try {
        (wc as any).destroy();
      } catch {
        // ignore
      }
    }

    this.messageCallback = undefined;
  }
}

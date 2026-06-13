/**
 * MusicShare — Window Manager
 * Phase 3.3–3.5: BaseWindow creation, system tray, WebContentsView attachment.
 */

import {
  app,
  BaseWindow,
  WebContentsView,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  dialog,
  desktopCapturer,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { PlayerBridge } from './player-bridge';
import { LayoutManager } from './layout-manager';
import { resolveTrack, convertSpotifyToYouTube } from './track-resolver';
import { appendCrashLog } from './crash-handler';
import { SpotifyAuthManager } from './spotify-auth';
import type { PlayerCommand, PlayerMessage } from '../shared/preload-api';
import { MusicServiceType } from '../shared/models';

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 700;
const BACKGROUND_COLOR = '#121212';

export class WindowManager {
  private win!: BaseWindow;
  private mainView!: WebContentsView;
  private playerBridge!: PlayerBridge;
  private layoutManager!: LayoutManager;
  private tray!: Tray;
  private playerServerUrl: string;
  private spotifyAuthManager: SpotifyAuthManager;
  private currentService: MusicServiceType = MusicServiceType.YouTube;
  private pendingAuthDeferred: {
    resolve: (value: { success: boolean; error?: string }) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  constructor(playerServerUrl: string, spotifyAuthManager: SpotifyAuthManager) {
    this.playerServerUrl = playerServerUrl;
    this.spotifyAuthManager = spotifyAuthManager;
    this.createBaseWindow();
    this.createMainView();
    this.createPlayerView();
    this.createTray();
    this.registerIpcHandlers();
    this.setupLayout();
  }

  private createBaseWindow(): void {
    this.win = new BaseWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      title: 'MusicShare',
      backgroundColor: BACKGROUND_COLOR,
      minWidth: 900,
      minHeight: 500,
      show: false, // Show after layout is ready to avoid visual flicker
    });

    this.win.on('closed', () => {
      this.destroy();
    });
  }

  private createMainView(): void {
    // Resolve preload script path relative to this module.
    // __dirname is dist/main/main/, so ../preload/preload.js points to dist/main/preload/preload.js
    const preloadPath = path.join(__dirname, '../preload/preload.js');

    this.mainView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: preloadPath,
      },
    });

    // Use __dirname (dist/main/main/) to reliably reach dist/renderer/index.html
    // in both development and packaged builds.
    const rendererPath = path.join(__dirname, '../../renderer/index.html');

    if (fs.existsSync(rendererPath)) {
      this.mainView.webContents.loadFile(rendererPath);
      this.mainView.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        const prefix = ['verbose', 'info', 'warning', 'error'][level] ?? 'log';
        console.log(`[RendererConsole][${prefix}] ${sourceId}:${line} ${message}`);
      });
    } else {
      // No renderer HTML yet. Load a blank dark page.
      console.warn('[Main] Renderer HTML not found at', rendererPath, '— falling back to blank page');
      this.mainView.webContents.loadURL('data:text/html,<html style="background:%23121212"></html>');
    }

    this.mainView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('[Main] did-fail-load:', errorCode, errorDescription, validatedURL);
    });

    this.mainView.webContents.once('did-finish-load', async () => {
      console.log('[Main] Renderer did-finish-load');
      const bodyHtml = await this.mainView.webContents.executeJavaScript('document.body.innerHTML');
      console.log('[Main] body HTML length:', bodyHtml.length);
      console.log('[Main] body HTML snippet:', bodyHtml.substring(0, 300));
      const title = await this.mainView.webContents.executeJavaScript('document.title');
      console.log('[Main] document.title:', title);
      this.win.show();
      this.mainView.webContents.openDevTools({ mode: 'detach' });
    });

    this.win.contentView.addChildView(this.mainView);
    Menu.setApplicationMenu(null);
  }

  private createPlayerView(): void {
    // Default to YouTube player initially.
    this.currentService = MusicServiceType.YouTube;
    this.playerBridge = new PlayerBridge(this.win.contentView, MusicServiceType.YouTube, this.playerServerUrl);

    // Relay player messages to the main renderer view.
    this.playerBridge.onPlayerMessage((msg: PlayerMessage) => {
      if (!this.mainView.webContents.isDestroyed()) {
        this.mainView.webContents.send('player-message', msg);
      }
    });

    // Phase 6.2: Relay WebRTC signaling from player preload to renderer.
    this.playerBridge.onPlayerSignaling((payload: unknown) => {
      if (!this.mainView.webContents.isDestroyed()) {
        this.mainView.webContents.send('player-signaling', payload);
      }
    });
  }

  private setupLayout(): void {
    this.layoutManager = new LayoutManager(
      this.win,
      this.mainView,
      this.playerBridge.getWebContentsView(),
    );
  }

  private createTray(): void {
    // Use an empty image as a placeholder; on Windows the tray text tooltip
    // still works. A proper icon should be added in Phase 9.
    const emptyIcon = nativeImage.createEmpty();
    this.tray = new Tray(emptyIcon);
    this.tray.setToolTip('MusicShare');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show MusicShare',
        click: () => {
          this.win.show();
          this.win.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        },
      },
    ]);
    this.tray.setContextMenu(contextMenu);

    this.tray.on('click', () => {
      if (this.win.isVisible()) {
        this.win.hide();
      } else {
        this.win.show();
        this.win.focus();
      }
    });

    // Minimize to tray instead of taskbar
    this.win.on('minimize', () => {
      this.win.hide();
    });
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('open-external', async (_, url: string) => {
      await shell.openExternal(url);
    });

    ipcMain.handle('resolve-track', async (_, url: string) => {
      return resolveTrack(url);
    });

    ipcMain.handle('convert-spotify-to-youtube', async (_, url: string) => {
      return convertSpotifyToYouTube(url);
    });

    ipcMain.handle('send-to-player', async (_, command: PlayerCommand) => {
      if (command.type === 'loadTrack' && command.service && this.currentService !== command.service) {
        this.switchPlayer(command.service);
        await this.playerBridge.whenReady();
      }
      await this.playerBridge.sendCommand(command);
    });

    // Allow renderer to request a player service switch.
    ipcMain.handle('switch-player', async (_, service: MusicServiceType) => {
      this.switchPlayer(service);
    });

    // Phase 8.1: Receive crash reports from renderer and append to crash.log
    ipcMain.handle('report-crash', async (_, detail: string) => {
      appendCrashLog(`[Renderer] ${detail}`);
    });

    // Phase 8.2: Show fatal error dialog from renderer
    ipcMain.handle('show-error-dialog', async (_, title: string, message: string) => {
      dialog.showErrorBox(title, message);
    });

    // Phase 6.1: Provide desktop audio source for WebRTC host broadcast
    ipcMain.handle('get-desktop-audio-source', async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 1, height: 1 },
        });

        // Match by window title.  Electron windows are listed by their title.
        const ourWindow = sources.find((s) => s.name === 'MusicShare');

        if (!ourWindow) {
          console.warn('[Main] MusicShare window not found in desktopCapturer sources');
          return null;
        }

        console.log('[Main] Found desktop audio source:', ourWindow.id, ourWindow.name);
        return { id: ourWindow.id, name: ourWindow.name };
      } catch (err) {
        console.error('[Main] desktopCapturer error:', err);
        return null;
      }
    });

    // Phase 6.2: Relay WebRTC signaling from renderer to player WebContentsView.
    ipcMain.on('send-player-signaling', this.onSendPlayerSignaling);

    // Phase 5: Spotify OAuth PKCE flow handlers.
    ipcMain.handle('start-spotify-auth', async () => {
      try {
        const { authUrl } = this.spotifyAuthManager.startAuth();
        await shell.openExternal(authUrl);

        return new Promise<{ success: boolean; error?: string }>((resolve) => {
          const timer = setTimeout(() => {
            if (this.pendingAuthDeferred) {
              this.pendingAuthDeferred = null;
              resolve({ success: false, error: 'Authorization timed out' });
            }
          }, 5 * 60 * 1000); // 5 minutes

          this.pendingAuthDeferred = { resolve, timer };
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    });

    ipcMain.handle('get-spotify-token', async () => {
      const token = await this.spotifyAuthManager.getValidAccessToken();
      return token;
    });
  }

  async handleSpotifyCallback(url: string): Promise<void> {
    const result = await this.spotifyAuthManager.completeAuth(url);
    if (this.pendingAuthDeferred) {
      clearTimeout(this.pendingAuthDeferred.timer);
      this.pendingAuthDeferred.resolve(result);
      this.pendingAuthDeferred = null;
    }
    if (result.success) {
      const token = await this.spotifyAuthManager.getValidAccessToken();
      if (token && !this.mainView.webContents.isDestroyed()) {
        this.mainView.webContents.send('spotify-token', token);
      }
      // Also push token to the player view only if it is currently Spotify.
      if (this.currentService === MusicServiceType.Spotify) {
        const playerWc = this.playerBridge.getWebContentsView().webContents;
        if (token && !playerWc.isDestroyed()) {
          playerWc.send('spotify-token', token);
        }
      }
    }
  }

  switchPlayer(service: MusicServiceType): void {
    if (this.currentService === service) return;
    this.currentService = service;
    const oldPlayer = this.playerBridge;

    // Create new bridge first so we can preserve message forwarding.
    this.playerBridge = new PlayerBridge(this.win.contentView, service, this.playerServerUrl);
    this.playerBridge.onPlayerMessage((msg: PlayerMessage) => {
      if (!this.mainView.webContents.isDestroyed()) {
        this.mainView.webContents.send('player-message', msg);
      }
    });
    this.playerBridge.onPlayerSignaling((payload: unknown) => {
      if (!this.mainView.webContents.isDestroyed()) {
        this.mainView.webContents.send('player-signaling', payload);
      }
    });

    // Update layout references
    this.layoutManager.destroy();
    this.layoutManager = new LayoutManager(
      this.win,
      this.mainView,
      this.playerBridge.getWebContentsView(),
    );

    // If switching to Spotify, push a valid token to the player immediately.
    if (service === MusicServiceType.Spotify) {
      this.spotifyAuthManager.getValidAccessToken().then((token) => {
        const playerWc = this.playerBridge.getWebContentsView().webContents;
        if (token && !playerWc.isDestroyed()) {
          playerWc.send('spotify-token', token);
        }
      });
    }

    // Dispose old player after a short delay so the Spotify SDK (or other
    // service) has time to clean up its remote device/session state before
    // a new instance tries to initialize with the same credentials.
    setTimeout(() => {
      oldPlayer.dispose();
    }, 1000);
  }

  getWindow(): BaseWindow {
    return this.win;
  }

  private destroy(): void {
    this.layoutManager?.destroy();
    this.playerBridge?.dispose();
    this.tray?.destroy();
    ipcMain.removeHandler('open-external');
    ipcMain.removeHandler('resolve-track');
    ipcMain.removeHandler('send-to-player');
    ipcMain.removeHandler('switch-player');
    ipcMain.removeHandler('report-crash');
    ipcMain.removeHandler('show-error-dialog');
    ipcMain.removeHandler('get-desktop-audio-source');
    ipcMain.removeHandler('start-spotify-auth');
    ipcMain.removeHandler('get-spotify-token');
    ipcMain.removeListener('send-player-signaling', this.onSendPlayerSignaling);
  }

  private onSendPlayerSignaling = (_event: Electron.IpcMainEvent, payload: unknown) => {
    this.playerBridge.sendSignaling(payload);
  };
}

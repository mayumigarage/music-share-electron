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
} from 'electron';
import * as path from 'path';
import { LayoutManager } from './layout-manager';
import { resolveTrack } from './track-resolver';
import { appendCrashLog } from './crash-handler';
import { SpotifyAuthManager } from './spotify-auth';
import type { TrackResolverDebugLog } from '../shared/preload-api';

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 700;
const BACKGROUND_COLOR = '#121212';

export class WindowManager {
  private win!: BaseWindow;
  private mainView!: WebContentsView;
  private layoutManager!: LayoutManager;
  private tray!: Tray;
  private rendererServerUrl: string;
  private spotifyAuthManager: SpotifyAuthManager;
  private pendingAuthDeferred: {
    resolve: (value: { success: boolean; error?: string }) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  constructor(rendererServerUrl: string, spotifyAuthManager: SpotifyAuthManager) {
    this.rendererServerUrl = rendererServerUrl;
    this.spotifyAuthManager = spotifyAuthManager;
    this.createBaseWindow();
    this.createMainView();
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

    const rendererOrigin = new URL(this.rendererServerUrl).origin;
    // YouTube requires a browser client identity. Avoid exposing Electron's
    // product token while retaining Chromium's normal user agent.
    this.mainView.webContents.setUserAgent(
      app.userAgentFallback.replace(/\sElectron\/[^\s]+/i, ''),
    );
    this.mainView.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['https://*.youtube.com/*', 'https://youtube.com/*'] },
      (details, callback) => {
        const headers = details.requestHeaders;
        if (!headers.Referer && !headers.referer) headers.Referer = `${rendererOrigin}/`;
        callback({ requestHeaders: headers });
      },
    );
    this.mainView.webContents.loadURL(`${this.rendererServerUrl}/index.html`);
    this.mainView.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const prefix = ['verbose', 'info', 'warning', 'error'][level] ?? 'log';
      console.log(`[RendererConsole][${prefix}] ${sourceId}:${line} ${message}`);
    });

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
    });

    // Keep developer tools closed by default, and make F12 explicitly toggle
    // the inspector for the main renderer view.
    this.mainView.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'F12') return;

      event.preventDefault();
      if (this.mainView.webContents.isDevToolsOpened()) {
        this.mainView.webContents.closeDevTools();
      } else {
        this.mainView.webContents.openDevTools({ mode: 'detach' });
      }
    });

    this.win.contentView.addChildView(this.mainView);
    Menu.setApplicationMenu(null);
  }

  private setupLayout(): void {
    this.layoutManager = new LayoutManager(
      this.win,
      this.mainView,
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

    // Let the platform handle minimization normally so the app remains
    // visible in the taskbar. The tray icon can still explicitly hide/show it.
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('set-sidebar-visibility', async (_, leftVisible: unknown, rightVisible: unknown) => {
      if (typeof leftVisible !== 'boolean' || typeof rightVisible !== 'boolean') {
        throw new TypeError('Sidebar visibility must be boolean values');
      }
      this.layoutManager.setSidebarVisibility(leftVisible, rightVisible);
    });

    ipcMain.handle('open-external', async (_, url: string) => {
      await shell.openExternal(url);
    });

    ipcMain.handle('resolve-track', async (_, url: string, options?: { searchQuery?: unknown }) => {
      const searchQuery = typeof options?.searchQuery === 'string'
        ? options.searchQuery.slice(0, 500)
        : undefined;
      return resolveTrack(url, (log: TrackResolverDebugLog) => {
        if (!this.mainView.webContents.isDestroyed()) {
          this.mainView.webContents.send('track-resolver-debug', log);
        }
      }, () => this.spotifyAuthManager.getValidAccessToken(), { searchQuery }, (result) => {
        if (!this.mainView.webContents.isDestroyed()) {
          this.mainView.webContents.send('youtube-music-candidates', result);
        }
      });
    });

    // Phase 8.1: Receive crash reports from renderer and append to crash.log
    ipcMain.handle('report-crash', async (_, detail: string) => {
      appendCrashLog(`[Renderer] ${detail}`);
    });

    // Phase 8.2: Show fatal error dialog from renderer
    ipcMain.handle('show-error-dialog', async (_, title: string, message: string) => {
      dialog.showErrorBox(title, message);
    });

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

    ipcMain.handle('set-spotify-token', async (_, token: string) => {
      this.spotifyAuthManager.injectToken(token);
      // Spotify account state is retained for the settings UI; playback itself
      // is always performed by the YouTube player.
      if (!this.mainView.webContents.isDestroyed()) {
        this.mainView.webContents.send('spotify-token', token);
      }
    });

    ipcMain.handle('clear-spotify-auth', async () => {
      this.spotifyAuthManager.clearTokens();
      // Broadcast null so the settings UI updates immediately.
      if (!this.mainView.webContents.isDestroyed()) {
        this.mainView.webContents.send('spotify-token', null);
      }
    });

    // If a stored token exists from a previous session, broadcast it now.
    this.broadcastInitialToken();
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
    }
  }

  private async broadcastInitialToken(): Promise<void> {
    try {
      const token = await this.spotifyAuthManager.getValidAccessToken();
      if (!token) return;
      if (!this.mainView.webContents.isDestroyed()) {
        this.mainView.webContents.send('spotify-token', token);
      }
    } catch {
      // Ignore errors; unauthenticated state is fine on startup
    }
  }

  getWindow(): BaseWindow {
    return this.win;
  }

  private destroy(): void {
    this.layoutManager?.destroy();
    this.tray?.destroy();
    ipcMain.removeHandler('open-external');
    ipcMain.removeHandler('set-sidebar-visibility');
    ipcMain.removeHandler('resolve-track');
    ipcMain.removeHandler('report-crash');
    ipcMain.removeHandler('show-error-dialog');
    ipcMain.removeHandler('start-spotify-auth');
    ipcMain.removeHandler('get-spotify-token');
    ipcMain.removeHandler('set-spotify-token');
    ipcMain.removeHandler('clear-spotify-auth');
  }
}

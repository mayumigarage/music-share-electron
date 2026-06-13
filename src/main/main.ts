/**
 * MusicShare — Main Process Entry Point
 * Phase 3.1–3.2: Electron app bootstrap with autoplay policy,
 * BaseWindow + WebContentsView creation, and lifecycle management.
 *
 * Widevine: Uses castLabs Electron (ECS) which bundles the Widevine CDM.
 *           Windows must be created after the CDM signals readiness.
 */

import { app } from 'electron';
import * as path from 'path';
import { initializeCrashHandler } from './crash-handler';
import { WindowManager } from './window-manager';
import { startPlayerServer, stopPlayerServer } from './player-server';
import { SpotifyAuthManager } from './spotify-auth';

// Allow media playback without user gesture (required for programmatic
// player control in the WebContentsView).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Enable Widevine CDM so the Spotify Web Playback SDK can use EME.
// This is the standard Electron switch; castLabs ECS extends it with
// bundled CDM binaries and a 'widevine-ready' event.
app.commandLine.appendSwitch('enable-widevine-cdm');

// Catch uncaught exceptions and unhandled promise rejections.
initializeCrashHandler();

let windowManager: WindowManager | null = null;
let playerServerUrl: string | null = null;
const spotifyAuthManager = new SpotifyAuthManager();

// Register custom protocol handler for OAuth callbacks.
if (app.isPackaged) {
  if (!app.setAsDefaultProtocolClient('musicshare')) {
    console.warn('[Main] Failed to register musicshare protocol handler');
  }
} else {
  // Development: register with electron.exe and pass the app entry path
  // so the second instance knows what to load.
  const appPath = path.resolve(process.argv[1] || '.');
  if (!app.setAsDefaultProtocolClient('musicshare', process.execPath, [appPath])) {
    console.warn('[Main] Failed to register musicshare protocol handler (dev)');
  }
}

const gotTheLock = app.requestSingleInstanceLock();
console.log('[Main] Single instance lock acquired:', gotTheLock);

if (!gotTheLock) {
  console.log('[Main] Another instance is already running, quitting.');
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Windows: the callback URL is passed as a command-line argument.
    const url = commandLine.find((arg) =>
      arg.startsWith('musicshare://spotify/callback'),
    );
    if (url && windowManager) {
      console.log('[Main] Received Spotify callback via second-instance');
      windowManager.handleSpotifyCallback(url);
    }

    // Focus the existing window.
    if (windowManager) {
      const win = windowManager.getWindow();
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  /**
   * Wait for Widevine CDM to become ready before creating any windows.
   * castLabs Electron (ECS) emits 'widevine-ready' once the bundled
   * CDM binaries are initialised. Creating a BaseWindow/WebContentsView
   * before this event can cause EME playback to fail silently.
   */
  app.on('widevine-ready', async (_event, widevineVersion) => {
    console.log(`[Main] Widevine ready (version ${widevineVersion})`);
    playerServerUrl = `http://127.0.0.1:${await startPlayerServer()}`;
    windowManager = new WindowManager(playerServerUrl, spotifyAuthManager);
  });

  app.on('widevine-error', async (_event, error) => {
    console.error('[Main] Widevine failed to initialise:', error);
    if (!windowManager) {
      playerServerUrl = `http://127.0.0.1:${await startPlayerServer()}`;
      windowManager = new WindowManager(playerServerUrl, spotifyAuthManager);
    }
  });

  // Fallback: if widevine-ready/widevine-error never fire (e.g. standard Electron),
  // create the window on the normal ready event so the app doesn't hang.
  app.whenReady().then(async () => {
    if (!windowManager) {
      console.warn('[Main] widevine-ready/widevine-error did not fire; falling back to app.whenReady()');
      playerServerUrl = `http://127.0.0.1:${await startPlayerServer()}`;
      windowManager = new WindowManager(playerServerUrl, spotifyAuthManager);
    }
  });

  app.on('window-all-closed', () => {
    stopPlayerServer();
    // On macOS it is common for applications to stay open until the user
    // explicitly quits with Cmd+Q.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On macOS re-create a window when the dock icon is clicked and no
    // windows are open.
    if (windowManager === null && playerServerUrl) {
      windowManager = new WindowManager(playerServerUrl, spotifyAuthManager);
    } else if (windowManager && !windowManager.getWindow().isVisible()) {
      windowManager.getWindow().show();
    }
  });

  // Handle Spotify OAuth callbacks via custom protocol (macOS / Linux).
  app.on('open-url', (_event, url) => {
    if (url.startsWith('musicshare://spotify/callback')) {
      console.log('[Main] Received Spotify callback via open-url');
      windowManager?.handleSpotifyCallback(url);
    }
  });

  // Security: prevent new window creation from navigations.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      console.warn('Blocked new window:', url);
      return { action: 'deny' };
    });
  });
}

/**
 * MusicShare — Main Process Entry Point
 * Phase 3.1–3.2: Electron app bootstrap with autoplay policy,
 * BaseWindow + WebContentsView creation, and lifecycle management.
 *
 * Widevine: Uses castLabs Electron (ECS) which bundles the Widevine CDM.
 *           Windows must be created after the CDM signals readiness.
 */

import { app, ipcMain, session } from 'electron';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { initializeCrashHandler } from './crash-handler';
import { WindowManager } from './window-manager';
import { startRendererServer, stopRendererServer } from './renderer-server';
import { SpotifyAuthManager } from './spotify-auth';
import type { AudioStreamMetadata, LocalAudioSearchResult } from '../shared/models';

function initializeTerminalEncoding(): void {
  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
  process.env.PYTHONUTF8 = process.env.PYTHONUTF8 || '1';
  process.env.PYTHONIOENCODING = process.env.PYTHONIOENCODING || 'utf-8';

  if (process.platform !== 'win32') return;

  try {
    execFileSync('chcp.com', ['65001'], { stdio: 'ignore', windowsHide: true });
  } catch (error) {
    console.warn('[Main] Failed to switch terminal code page to UTF-8:', error);
  }
}

initializeTerminalEncoding();

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
let rendererServerUrl: string | null = null;
const spotifyAuthManager = new SpotifyAuthManager();
let mediaRequestLoggingInitialized = false;

type HeaderValue = string | string[] | undefined;
type HeaderMap = Record<string, HeaderValue>;

function maskSensitiveUrl(value: string): string {
  try {
    const parsed = new URL(value);
    for (const key of parsed.searchParams.keys()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('sig') || lowerKey === 'lsig' || lowerKey === 'signature') {
        parsed.searchParams.set(key, '[masked]');
      }
    }
    return parsed.toString().slice(0, 200);
  } catch {
    return value.slice(0, 200);
  }
}

function getHeader(headers: HeaderMap | undefined, name: string): HeaderValue {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === lowerName);
  const value = key ? headers[key] : undefined;
  if (lowerName === 'authorization' || lowerName === 'cookie') return value === undefined ? undefined : '[masked]';
  return value;
}

function formatHeader(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

function logMediaRequest(
  phase: 'before-request' | 'before-send-headers' | 'headers-received' | 'completed' | 'failed',
  details: {
    url: string;
    method?: string;
    resourceType?: string;
    statusCode?: number;
    error?: string;
    requestHeaders?: HeaderMap;
    responseHeaders?: HeaderMap;
    fromCache?: boolean;
  },
): void {
  console.log(`[MediaRequest][${phase}] ${JSON.stringify({
    url: maskSensitiveUrl(details.url),
    method: details.method,
    resourceType: details.resourceType,
    statusCode: details.statusCode,
    error: details.error,
    requestHeaders: details.requestHeaders ? {
      'user-agent': formatHeader(getHeader(details.requestHeaders, 'user-agent')),
      referer: formatHeader(getHeader(details.requestHeaders, 'referer')),
      range: formatHeader(getHeader(details.requestHeaders, 'range')),
    } : undefined,
    responseHeaders: details.responseHeaders ? {
      'content-type': formatHeader(getHeader(details.responseHeaders, 'content-type')),
      'content-length': formatHeader(getHeader(details.responseHeaders, 'content-length')),
      'accept-ranges': formatHeader(getHeader(details.responseHeaders, 'accept-ranges')),
      location: formatHeader(getHeader(details.responseHeaders, 'location')),
    } : undefined,
    fromCache: details.fromCache,
  }, null, 2)}`);
}

function initializeMediaRequestLogging(): void {
  if (mediaRequestLoggingInitialized) return;
  mediaRequestLoggingInitialized = true;

  const filter = { urls: ['*://*.googlevideo.com/videoplayback*'] };
  const webRequest = session.defaultSession.webRequest;

  webRequest.onBeforeRequest(filter, (details, callback) => {
    logMediaRequest('before-request', details);
    callback({});
  });

  webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    logMediaRequest('before-send-headers', details);
    callback({ requestHeaders: details.requestHeaders });
  });

  webRequest.onHeadersReceived(filter, (details, callback) => {
    logMediaRequest('headers-received', details);
    callback({ responseHeaders: details.responseHeaders });
  });

  webRequest.onCompleted(filter, (details) => {
    logMediaRequest('completed', details);
  });

  webRequest.onErrorOccurred(filter, (details) => {
    logMediaRequest('failed', details);
  });
}

function resolveAudioStreamPlaceholder(mediaId: string): AudioStreamMetadata {
  const normalizedMediaId = mediaId.trim();
  if (!normalizedMediaId) {
    throw new TypeError('mediaId must be a non-empty string');
  }

  return {
    title: `Local Audio ${normalizedMediaId}`,
    artist: 'Unknown Artist',
    url: `musicshare://local-audio/${encodeURIComponent(normalizedMediaId)}`,
  };
}

function searchLocalAudioPlaceholder(query: string): LocalAudioSearchResult[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const idBase = normalizedQuery
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'local-audio';

  return [
    {
      id: `local-${idBase}`,
      title: normalizedQuery,
      artist: 'Unknown Artist',
      thumbnailUrl: '',
      durationSeconds: null,
    },
  ];
}

ipcMain.handle('get-audio-stream', async (_event, mediaId: unknown): Promise<AudioStreamMetadata> => {
  if (typeof mediaId !== 'string') {
    throw new TypeError('mediaId must be a string');
  }

  return resolveAudioStreamPlaceholder(mediaId);
});

ipcMain.handle('search-local-audio', async (_event, query: unknown): Promise<LocalAudioSearchResult[]> => {
  if (typeof query !== 'string') {
    throw new TypeError('query must be a string');
  }

  return searchLocalAudioPlaceholder(query);
});

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
    await spotifyAuthManager.initialize();
    rendererServerUrl = await startRendererServer();
    windowManager = new WindowManager(rendererServerUrl, spotifyAuthManager);
  });

  app.on('widevine-error', async (_event, error) => {
    console.error('[Main] Widevine failed to initialise:', error);
    if (!windowManager) {
      await spotifyAuthManager.initialize();
      rendererServerUrl = await startRendererServer();
      windowManager = new WindowManager(rendererServerUrl, spotifyAuthManager);
    }
  });

  // Fallback: if widevine-ready/widevine-error never fire (e.g. standard Electron),
  // create the window on the normal ready event so the app doesn't hang.
  app.whenReady().then(async () => {
    initializeMediaRequestLogging();
    if (!windowManager) {
      console.warn('[Main] widevine-ready/widevine-error did not fire; falling back to app.whenReady()');
      await spotifyAuthManager.initialize();
      rendererServerUrl = await startRendererServer();
      windowManager = new WindowManager(rendererServerUrl, spotifyAuthManager);
    }
  });

  app.on('window-all-closed', () => {
    stopRendererServer();
    // On macOS it is common for applications to stay open until the user
    // explicitly quits with Cmd+Q.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On macOS re-create a window when the dock icon is clicked and no
    // windows are open.
    if (windowManager === null && rendererServerUrl) {
      windowManager = new WindowManager(rendererServerUrl, spotifyAuthManager);
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

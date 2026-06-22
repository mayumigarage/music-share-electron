/**
 * MusicShare — Renderer Entry Point
 * Phase 6: Initializes UI modules and sync engine.
 */

import { AppUI } from './ui/app.js';
import { WebSocketClient } from './sync/websocket-client.js';
import { SyncEngine } from './sync/sync-engine.js';
import { PlayerProxy } from './sync/player-proxy.js';
import { initializeSidebarResizers } from './ui/sidebar-resizer.js';

async function main(): Promise<void> {
  console.log('[Renderer] main() started');
  let app: AppUI | null = null;

  try {
    initializeSidebarResizers();
    const wsClient = new WebSocketClient();
    const playerProxy = new PlayerProxy();
    const syncEngine = new SyncEngine(wsClient, playerProxy);

    app = new AppUI(wsClient, syncEngine, playerProxy);
    await app.init();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[Renderer] Fatal startup error:', e);
    window.electronAPI.reportCrash(`Fatal startup error: ${e instanceof Error ? e.stack || e.message : String(e)}`);
    window.electronAPI.showErrorDialog('MusicShare 起動エラー', `アプリケーションの起動に失敗しました。\n\n${message}`);
    throw e;
  }

  // Phase 8.1: Global error handler for renderer — report to main crash.log
  window.addEventListener('error', (e) => {
    const detail = e.error?.stack || e.error?.message || e.message || 'Unknown error';
    console.error('[Renderer] Uncaught error:', e.error);
    window.electronAPI.reportCrash(`Uncaught error: ${detail}`);
    app.showToast(`エラーが発生しました: ${e.message}`, 'error');
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason);
    console.error('[Renderer] Unhandled rejection:', e.reason);
    window.electronAPI.reportCrash(`Unhandled rejection: ${reason}`);
    app.showToast(`予期しないエラーが発生しました`, 'error');
  });
}

main();

/**
 * MusicShare — App UI Controller
 * Phase 6: UI initialization, event binding, dark theme, modal management.
 */

import type { WebSocketClient } from '../sync/websocket-client.js';
import type { SyncEngine } from '../sync/sync-engine.js';
import type { PlayerProxy } from '../sync/player-proxy.js';
import { PlaylistPanel } from './playlist-panel.js';
import { QueuePanel } from './queue-panel.js';
import { HistoryPanel } from './history-panel.js';
import { MembersPanel } from './members-panel.js';
import { PlayerControl } from './player-control.js';
import { RoomModal } from './room-modal.js';
import { SettingsModal } from './settings-modal.js';
import type {
  Room,
  User,
  Track,
  PlayerState,
  TrackHistory,
  RoomMode,
} from '../../shared/models.js';

export class AppUI {
  private playlistPanel: PlaylistPanel;
  private queuePanel: QueuePanel;
  private historyPanel: HistoryPanel;
  private membersPanel: MembersPanel;
  private playerControl: PlayerControl;
  private roomModal: RoomModal;
  private settingsModal: SettingsModal;

  private currentRoom: Room | null = null;
  private currentUser: User | null = null;
  private isSpotifyAuthenticated = false;
  private showSpotifyAuthRequested = false;

  // Debounce rapid consecutive player errors to prevent infinite skip loops
  private lastPlayerErrorAt = 0;
  private playerErrorCount = 0;

  // DOM refs
  private roomInfo = document.getElementById('room-info') as HTMLElement;
  private roomIdDisplay = document.getElementById('room-id-display') as HTMLElement;
  private roomModeDisplay = document.getElementById('room-mode-display') as HTMLElement;
  private toastContainer = document.getElementById('toast-container') as HTMLElement;
  private topBarBrand = document.querySelector('#top-bar .brand') as HTMLElement;
  private spotifyAuthBanner = document.getElementById('spotify-auth-banner') as HTMLElement;
  private spotifyAuthLabel = document.getElementById('spotify-auth-label') as HTMLElement;
  private spotifyAuthStatus = document.getElementById('spotify-auth-status') as HTMLElement;
  private btnSpotifyLogin = document.getElementById('btn-spotify-login') as HTMLButtonElement;

  constructor(
    private wsClient: WebSocketClient,
    private syncEngine: SyncEngine,
    private playerProxy: PlayerProxy,
  ) {
    this.playlistPanel = new PlaylistPanel();
    this.queuePanel = new QueuePanel(wsClient, this.showToast.bind(this));
    this.historyPanel = new HistoryPanel();
    this.membersPanel = new MembersPanel();
    this.playerControl = new PlayerControl(playerProxy, wsClient, syncEngine);
    this.roomModal = new RoomModal(wsClient);
    this.settingsModal = new SettingsModal();
  }

  async init(): Promise<void> {
    this.bindGlobalEvents();
    this.bindTopBar();

    this.playlistPanel.init();
    this.queuePanel.init();
    this.historyPanel.init();
    this.membersPanel.init();
    this.playerControl.init();
    this.roomModal.init();
    this.settingsModal.init();

    this.wsClient.onRoomCreated = (room, user) => this.handleRoomJoined(room, user);
    this.wsClient.onRoomJoined = (room, user) => this.handleRoomJoined(room, user);
    this.wsClient.onRoomLeft = () => this.handleRoomLeft();
    this.wsClient.onUserJoined = (user) => {
      this.membersPanel.addMember(user);
      this.syncEngine.handleUserJoined(user);
    };
    this.wsClient.onUserLeft = (userId) => {
      this.membersPanel.removeMember(userId);
      this.syncEngine.handleUserLeft(userId);
    };
    this.wsClient.onHostTransferred = (newHostId) => this.handleHostTransferred(newHostId);
    this.wsClient.onQueueUpdated = (queue) => this.queuePanel.setQueue(queue);
    this.wsClient.onTrackAdded = (track) => {
      this.showToast(`「${track.title}」が追加されました`, 'success');
    };
    this.wsClient.onHistoryUpdated = (history) => this.historyPanel.setHistory(history);
    this.wsClient.onPlayerStateUpdated = (state) => {
      this.handlePlayerStateUpdated(state);
      this.syncEngine.handlePlayerStateUpdated(state);
    };
    this.wsClient.onError = (code, message) => {
      if (code === 'JOIN_FAILED') {
        this.showToast('ルームに参加できませんでした', 'error');
        return;
      }
      this.showToast(message, 'error');
    };

    // WebRTC guest-limit toast
    this.syncEngine.onGuestLimitReached = () => {
      this.showToast('ホスト配信の接続数上限に達しました（最大5人）', 'error');
    };

    // Player error (e.g. YT 153, Spotify playback failure) — skip to next track on host
    this.syncEngine.onPlayerError = (errorDetail) => {
      const now = Date.now();
      if (now - this.lastPlayerErrorAt < 8000) {
        this.playerErrorCount++;
      } else {
        this.playerErrorCount = 1;
      }
      this.lastPlayerErrorAt = now;

      console.error('[AppUI] Player error detail:', errorDetail);

      const friendlyMessage = this.resolveSpotifyErrorMessage(errorDetail);

      // If we've errored 3+ times within 8 seconds, stop instead of looping forever
      if (this.playerErrorCount >= 3) {
        this.showToast(friendlyMessage || '複数の曲が再生できません。再生を停止します。', 'error');
        if (this.currentRoom && this.currentUser?.id === this.currentRoom.hostId) {
          this.playerProxy.stop();
          this.currentRoom.playerState.isPlaying = false;
          this.currentRoom.playerState.positionSeconds = 0;
          this.syncEngine.broadcastPlayerState();
        }
        return;
      }

      this.showToast(friendlyMessage || 'この曲は再生できません。次の曲にスキップします。', 'error');
      if (this.currentRoom && this.currentUser?.id === this.currentRoom.hostId) {
        const currentTrackId = this.currentRoom.playerState.currentTrack?.id;
        if (currentTrackId) {
          this.wsClient.trackFinished(currentTrackId);
        }
      }
    };

    this.bindSpotifyAuth();
    // Show room modal immediately on launch
    this.roomModal.open();
  }

  private bindSpotifyAuth(): void {
    // Button click: start OAuth flow
    this.btnSpotifyLogin.addEventListener('click', async () => {
      this.spotifyAuthStatus.textContent = '認証画面を開きました...';
      this.spotifyAuthStatus.style.color = 'var(--text-secondary)';
      try {
        const result = await window.electronAPI.startSpotifyAuth();
        if (!result.success) {
          this.spotifyAuthStatus.textContent = result.error || '認証に失敗しました';
          this.spotifyAuthStatus.style.color = 'var(--danger)';
          this.showToast(`Spotify 認証エラー: ${result.error}`, 'error');
        } else {
          this.spotifyAuthStatus.textContent = '認可を待っています...';
          this.spotifyAuthStatus.style.color = 'var(--text-secondary)';
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.spotifyAuthStatus.textContent = msg;
        this.spotifyAuthStatus.style.color = 'var(--danger)';
      }
    });

    // Listen for token updates from main process
    window.electronAPI.onSpotifyToken((token) => {
      if (token) {
        this.isSpotifyAuthenticated = true;
        this.showSpotifyAuthRequested = false;
        this.updateSpotifyAuthUI();
        this.showToast('Spotify ログイン完了', 'success');
      } else {
        this.isSpotifyAuthenticated = false;
        this.updateSpotifyAuthUI();
      }
    });

    // Listen for player auth_required errors
    window.electronAPI.onPlayerMessage((message) => {
      if (message.type === 'error' && message.error?.startsWith('auth_required')) {
        // Reset auth state so the login button reappears
        this.isSpotifyAuthenticated = false;
        this.showSpotifyAuthRequested = true;
        this.updateSpotifyAuthUI();
        this.showToast('Spotify セッションが無効です。再ログインしてください。', 'error');
      }
    });

    // Check initial token status
    this.refreshSpotifyAuthStatus();
  }

  private async refreshSpotifyAuthStatus(): Promise<void> {
    try {
      const token = await window.electronAPI.getSpotifyToken();
      this.isSpotifyAuthenticated = !!token;
      this.updateSpotifyAuthUI();
    } catch {
      this.isSpotifyAuthenticated = false;
      this.updateSpotifyAuthUI();
    }
  }

  private updateSpotifyAuthUI(): void {
    const hasAuth = this.isSpotifyAuthenticated;
    const needsAuth = this.showSpotifyAuthRequested || !hasAuth;

    if (needsAuth) {
      this.spotifyAuthBanner.style.display = 'flex';
      if (hasAuth) {
        this.spotifyAuthLabel.textContent = 'Spotify ログイン済み ✅';
        this.spotifyAuthStatus.textContent = '認証完了';
        this.spotifyAuthStatus.style.color = 'var(--accent)';
        this.btnSpotifyLogin.style.display = 'none';
      } else {
        this.spotifyAuthLabel.textContent = 'Spotify にログインしてください';
        this.spotifyAuthStatus.textContent = this.showSpotifyAuthRequested
          ? 'セッションが無効です。再ログインしてください。'
          : '未認証';
        this.spotifyAuthStatus.style.color = 'var(--text-secondary)';
        this.btnSpotifyLogin.style.display = 'inline-flex';
        this.btnSpotifyLogin.textContent = 'Spotify にログイン';
      }
    } else {
      // If authenticated and no explicit request to show, hide the auth banner
      this.spotifyAuthBanner.style.display = 'none';
    }
  }

  /** Translate low-level Spotify error strings into user-friendly messages. */
  private resolveSpotifyErrorMessage(errorDetail: string): string | null {
    const lower = errorDetail.toLowerCase();
    if (lower.includes('premium')) {
      return 'Spotify Premium が必要です。無料アカウントでは再生できません。';
    }
    if (lower.includes('no active device') || lower.includes('device not found')) {
      return 'Spotify デバイスが見つかりません。再ログインしてください。';
    }
    if (lower.includes('restriction')) {
      return 'この曲はお住まいの地域では再生できません。';
    }
    if (lower.includes('expired') || lower.includes('invalid access token')) {
      return 'Spotify セッションが期限切れです。再ログインしてください。';
    }
    if (lower.includes('auth_required')) {
      return 'Spotify ログインが必要です。';
    }
    if (lower.includes('account_error')) {
      return 'Spotify アカウントで問題が発生しました。Premium プランをご確認ください。';
    }
    return null;
  }

  private bindGlobalEvents(): void {
    // Close context menu on click elsewhere
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('context-menu');
      if (menu && !menu.contains(e.target as Node)) {
        menu.style.display = 'none';
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        this.playerControl.togglePlayPause();
      }
    });
  }

  private bindTopBar(): void {
    this.topBarBrand.addEventListener('click', () => {
      if (this.currentRoom) {
        this.showToast(`Room ID: ${this.currentRoom.id} (クリップボードにコピー)`, 'info');
        navigator.clipboard.writeText(this.currentRoom.id).catch(() => void 0);
      }
    });

    const settingsBtn = document.getElementById('btn-settings');
    settingsBtn?.addEventListener('click', () => {
      this.settingsModal.open();
    });
  }

  private handleRoomJoined(room: Room, user: User): void {
    this.currentRoom = room;
    this.currentUser = user;
    this.syncEngine.setRoom(room, user);

    this.roomInfo.style.display = 'flex';
    this.roomIdDisplay.textContent = room.id;
    this.roomModeDisplay.textContent = room.mode === 'HostBroadcast' ? 'ホスト配信' : '個別再生';

    this.queuePanel.setQueue(room.queue);
    this.historyPanel.setHistory(room.history);
    this.membersPanel.setMembers(room.users, room.hostId);
    this.playerControl.setRoom(room, user);

    this.showToast(`ルーム「${room.name}」に参加しました`, 'success');
    // Refresh Spotify auth status when joining a room
    this.refreshSpotifyAuthStatus();
  }

  private handleRoomLeft(): void {
    this.currentRoom = null;
    this.currentUser = null;
    this.syncEngine.setRoom(null, null);

    this.roomInfo.style.display = 'none';
    this.roomIdDisplay.textContent = '';
    this.queuePanel.setQueue([]);
    this.historyPanel.setHistory([]);
    this.membersPanel.setMembers([], '');
    this.playerControl.setRoom(null, null);

    this.showToast('ルームから退出しました', 'info');
    this.roomModal.open();
  }

  private handleHostTransferred(newHostId: string): void {
    if (!this.currentRoom) return;
    this.currentRoom.hostId = newHostId;
    this.currentRoom.users.forEach((u) => {
      u.isHost = u.id === newHostId;
    });
    this.membersPanel.setMembers(this.currentRoom.users, newHostId);
    this.syncEngine.handleHostTransferred(newHostId);

    const newHost = this.currentRoom.users.find((u) => u.id === newHostId);
    this.showToast(`ホストが ${newHost?.name ?? '不明'} に移行しました`, 'info');
  }

  private handlePlayerStateUpdated(state: PlayerState): void {
    this.playerControl.updateState(state);
    this.updateNowPlaying(state.currentTrack, state.isPlaying);
  }

  private updateNowPlaying(track: Track | null, isPlaying: boolean): void {
    const thumb = document.getElementById('now-playing-thumb') as HTMLImageElement;
    const title = document.getElementById('now-playing-title') as HTMLElement;
    const artist = document.getElementById('now-playing-artist') as HTMLElement;

    if (track) {
      if (track.thumbnailUrl) {
        thumb.src = track.thumbnailUrl;
        thumb.style.display = 'block';
      } else {
        thumb.style.display = 'none';
      }
      title.textContent = track.title;
      artist.textContent = track.artist;
    } else {
      thumb.style.display = 'none';
      title.textContent = '停止中';
      artist.textContent = '';
    }

    const playBtn = document.getElementById('btn-play-pause') as HTMLButtonElement;
    playBtn.textContent = isPlaying ? '⏸️' : '▶️';
  }

  showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    if (type === 'error') {
      toast.style.borderLeft = '3px solid var(--danger)';
    } else if (type === 'success') {
      toast.style.borderLeft = '3px solid var(--accent)';
    } else {
      toast.style.borderLeft = '3px solid #3ea6ff';
    }

    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

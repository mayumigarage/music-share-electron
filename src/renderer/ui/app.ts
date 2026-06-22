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
import { SettingsModal } from './settings-modal.js';
import { FavoritesStore } from './favorites-store.js';
import { RoomMode } from '../../shared/models.js';
import type {
  Room,
  User,
  Track,
  PlayerState,
  TrackHistory,
} from '../../shared/models.js';

type Workspace = 'playlist' | 'queue';
type CenterTab = 'queue' | 'history' | 'search';

export class AppUI {
  private playlistPanel: PlaylistPanel;
  private queuePanel: QueuePanel;
  private historyPanel: HistoryPanel;
  private membersPanel: MembersPanel;
  private playerControl: PlayerControl;
  private settingsModal: SettingsModal;
  private favoritesStore = new FavoritesStore();

  private currentRoom: Room | null = null;
  private currentUser: User | null = null;
  private isSpotifyAuthenticated = false;
  private showSpotifyAuthRequested = false;

  // DOM refs
  private toastContainer = document.getElementById('toast-container') as HTMLElement;
  private spotifyAuthBanner = document.getElementById('spotify-auth-banner') as HTMLElement;
  private spotifyAuthLabel = document.getElementById('spotify-auth-label') as HTMLElement;
  private spotifyAuthStatus = document.getElementById('spotify-auth-status') as HTMLElement;
  private btnSpotifyLogin = document.getElementById('btn-spotify-login') as HTMLButtonElement;
  private playlistCenterPanel = document.getElementById('playlist-center-panel') as HTMLElement;
  private sharedCenterPanel = document.getElementById('shared-center-panel') as HTMLElement;
  private playlistCenterTitle = document.getElementById('playlist-center-title') as HTMLElement;
  private playlistHeroCover = document.getElementById('playlist-hero-cover') as HTMLElement;
  private sidebarRoomName = document.getElementById('sidebar-room-name') as HTMLElement;
  private sidebarRoomId = document.getElementById('sidebar-room-id') as HTMLElement;
  private btnCopyRoomId = document.getElementById('btn-copy-room-id') as HTMLButtonElement;
  private btnLeaveRoom = document.getElementById('btn-leave-room') as HTMLButtonElement;
  private roomEntry = document.getElementById('room-entry') as HTMLElement;
  private roomDetails = document.getElementById('room-details') as HTMLElement;
  private appLayout = document.getElementById('app-layout') as HTMLElement;
  private isLeftSidebarVisible = true;
  private isRightSidebarVisible = true;
  private selectedPlaylistId = 'favorites';

  constructor(
    private wsClient: WebSocketClient,
    private syncEngine: SyncEngine,
    private playerProxy: PlayerProxy,
  ) {
    this.playlistPanel = new PlaylistPanel();
    this.queuePanel = new QueuePanel(
      wsClient,
      this.showToast.bind(this),
      this.favoritesStore,
      this.renderFavoritePlaylist.bind(this),
    );
    this.historyPanel = new HistoryPanel();
    this.membersPanel = new MembersPanel();
    this.playerControl = new PlayerControl(playerProxy, wsClient, syncEngine);
    this.settingsModal = new SettingsModal();
  }

  async init(): Promise<void> {
    // Keep this in the renderer so logs appear in the detached DevTools Console.
    // Code points make mojibake distinguishable from a DevTools display issue.
    window.electronAPI.onTrackResolverDebug((log) => {
      if (log.stage === 'spotify-web-api') {
        console.log(`[TrackResolver][${log.stage}]`, {
          sourceUrl: log.sourceUrl,
          title: log.title,
          artist: log.artist,
          details: log.details,
        });
        return;
      }

      if (log.stage === 'spotify-metadata') {
        console.log('[TrackResolver][Spotify metadata]', {
          sourceUrl: log.sourceUrl,
          title: log.title,
          artist: log.artist,
          titleCodePoints: log.titleCodePoints,
          artistCodePoints: log.artistCodePoints,
        });
        return;
      }

      console.log('[TrackResolver][yt-dlp command]', {
        sourceUrl: log.sourceUrl,
        candidate: log.candidateType,
        searchQuery: log.searchQuery,
        // execFile passes an argv array (not a shell command string), so this
        // is the exact argument sequence delivered to yt-dlp.
        command: ['yt-dlp', ...(log.ytDlpArgs || [])],
      });
    });

    this.bindGlobalEvents();
    this.bindTopBar();
    this.bindRightSidebar();
    this.bindSidebarToggles();

    this.playlistPanel.init();
    this.queuePanel.init();
    this.historyPanel.init();
    this.membersPanel.init();
    this.playerControl.init();
    this.settingsModal.init();
    this.renderFavoritePlaylist();

    this.wsClient.onRoomCreated = (room, user) => this.handleRoomJoined(room, user);
    this.wsClient.onRoomJoined = (room, user) => this.handleRoomJoined(room, user);
    this.wsClient.onRoomLeft = () => this.handleRoomLeft();
    this.wsClient.onUserJoined = (user) => {
      this.membersPanel.addMember(user);
    };
    this.wsClient.onUserLeft = (userId) => {
      this.membersPanel.removeMember(userId);
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
    this.syncEngine.onHostPlayerStateObserved = (state) => {
      this.handlePlayerStateUpdated(state);
    };
    this.wsClient.onError = (code, message) => {
      if (code === 'JOIN_FAILED') {
        this.showToast('ルームに参加できませんでした', 'error');
        return;
      }
      this.showToast(message, 'error');
    };

    // Player error (e.g. YT 153, Spotify playback failure). Skip/retry policy
    // is centralized in SyncEngine so it can use the authoritative track state.
    this.syncEngine.onPlayerError = (errorDetail) => {
      console.error('[AppUI] Player error detail:', errorDetail);
      const friendlyMessage = this.resolveSpotifyErrorMessage(errorDetail);
      this.showToast(friendlyMessage || '再生中にエラーが発生しました。', 'error');
    };

    this.bindSpotifyAuth();
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

      const sortMenu = document.getElementById('sort-menu');
      const sortWrapper = document.querySelector('.sort-wrapper');
      if (sortMenu && !sortWrapper?.contains(e.target as Node)) {
        sortMenu.classList.remove('open');
        document.getElementById('btn-sort')?.setAttribute('aria-expanded', 'false');
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
    const settingsBtn = document.getElementById('btn-settings');
    settingsBtn?.addEventListener('click', () => {
      this.settingsModal.open();
    });

    document.querySelectorAll<HTMLButtonElement>('.workspace-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const workspace = tab.dataset.workspace;
        if (workspace === 'playlist' || workspace === 'queue') {
          this.setWorkspace(workspace);
        }
      });
    });

    document.getElementById('btn-header-add-track')?.addEventListener('click', () => {
      this.queuePanel.openAddModal();
    });

    const sortButton = document.getElementById('btn-sort') as HTMLButtonElement | null;
    const sortMenu = document.getElementById('sort-menu');
    sortButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = sortMenu?.classList.toggle('open') ?? false;
      sortButton.setAttribute('aria-expanded', String(isOpen));
    });

    sortMenu?.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((item) => {
      item.addEventListener('click', () => {
        const sort = item.dataset.sort;
        if (sort === 'title-asc' || sort === 'title-desc' || sort === 'duration-asc' || sort === 'duration-desc') {
          this.queuePanel.sortQueue(sort);
          this.showToast('共有キューの並び順を更新しました', 'success');
        }
        sortMenu?.classList.remove('open');
        sortButton?.setAttribute('aria-expanded', 'false');
      });
    });

    document.querySelectorAll<HTMLButtonElement>('#center-tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        if (name === 'queue' || name === 'history' || name === 'search') {
          this.setCenterTab(name);
        }
      });
    });

    window.addEventListener('musicshare:playlist-selected', (event) => {
      const { id, name, cover } = (event as CustomEvent<{ id: string; name: string; cover: string }>).detail;
      this.selectedPlaylistId = id;
      this.playlistCenterTitle.textContent = name;
      this.playlistHeroCover.textContent = cover;
      if (id === 'favorites') {
        this.renderFavoritePlaylist();
      }
      this.setWorkspace('playlist');
    });
  }

  private renderFavoritePlaylist(): void {
    if (this.selectedPlaylistId !== 'favorites') return;
    const list = document.getElementById('favorite-playlist-list') as HTMLElement;
    const favorites = this.favoritesStore.getTracks();
    list.innerHTML = '';

    if (favorites.length === 0) {
      list.innerHTML = '<div class="empty-state">お気に入りに追加した曲はここに表示されます</div>';
      return;
    }

    favorites.forEach((track) => {
      const item = document.createElement('div');
      item.className = 'track-item';

      const thumb = document.createElement('img');
      thumb.className = 'track-thumb';
      thumb.src = track.thumbnailUrl || '';
      thumb.alt = '';

      const info = document.createElement('div');
      info.className = 'track-info';
      const title = document.createElement('div');
      title.className = 'track-title';
      title.textContent = track.title;
      const artist = document.createElement('div');
      artist.className = 'track-meta';
      artist.textContent = track.artist;
      info.append(title, artist);

      const favoriteBtn = document.createElement('button');
      favoriteBtn.className = 'track-favorite is-favorite';
      favoriteBtn.textContent = '★';
      favoriteBtn.title = 'お気に入りから削除';
      favoriteBtn.setAttribute('aria-label', favoriteBtn.title);
      favoriteBtn.addEventListener('click', () => {
        this.favoritesStore.toggle(track);
        this.renderFavoritePlaylist();
      });

      item.append(thumb, info, favoriteBtn);
      list.appendChild(item);
    });
  }

  private bindRightSidebar(): void {
    const createModeButton = document.getElementById('btn-room-create-mode') as HTMLButtonElement;
    const joinModeButton = document.getElementById('btn-room-join-mode') as HTMLButtonElement;
    const createForm = document.getElementById('room-create-form-sidebar') as HTMLFormElement;
    const joinForm = document.getElementById('room-join-form-sidebar') as HTMLFormElement;

    const setRoomEntryMode = (mode: 'create' | 'join') => {
      const isCreate = mode === 'create';
      createModeButton.classList.toggle('active', isCreate);
      joinModeButton.classList.toggle('active', !isCreate);
      createForm.style.display = isCreate ? 'flex' : 'none';
      joinForm.style.display = isCreate ? 'none' : 'flex';
    };
    createModeButton.addEventListener('click', () => setRoomEntryMode('create'));
    joinModeButton.addEventListener('click', () => setRoomEntryMode('join'));

    createForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const roomName = (document.getElementById('input-sidebar-room-name') as HTMLInputElement).value.trim();
      const userName = (document.getElementById('input-sidebar-user-name-create') as HTMLInputElement).value.trim();
      if (!roomName || !userName) {
        this.showToast('ルーム名とあなたの名前を入力してください', 'error');
        return;
      }
      this.wsClient.createRoom(roomName, userName, RoomMode.Individual);
    });

    joinForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const roomId = (document.getElementById('input-sidebar-room-id') as HTMLInputElement).value.trim();
      const userName = (document.getElementById('input-sidebar-user-name-join') as HTMLInputElement).value.trim();
      if (!roomId || !userName) {
        this.showToast('ルームIDとあなたの名前を入力してください', 'error');
        return;
      }
      this.wsClient.joinRoom(roomId, userName);
    });

    this.btnCopyRoomId.addEventListener('click', () => {
      if (!this.currentRoom) return;
      navigator.clipboard.writeText(this.currentRoom.id)
        .then(() => this.showToast('ルームIDをコピーしました', 'success'))
        .catch(() => this.showToast('ルームIDをコピーできませんでした', 'error'));
    });

    const leaveRoom = () => {
      if (!this.currentRoom) return;
      this.wsClient.leaveRoom();
    };
    this.btnLeaveRoom.addEventListener('click', leaveRoom);
  }

  private bindSidebarToggles(): void {
    const leftButton = document.getElementById('btn-toggle-left-sidebar') as HTMLButtonElement;
    const rightButton = document.getElementById('btn-toggle-right-sidebar') as HTMLButtonElement;

    leftButton.addEventListener('click', () => {
      this.isLeftSidebarVisible = !this.isLeftSidebarVisible;
      this.updateSidebarVisibility();
    });
    rightButton.addEventListener('click', () => {
      this.isRightSidebarVisible = !this.isRightSidebarVisible;
      this.updateSidebarVisibility();
    });
  }

  private updateSidebarVisibility(): void {
    this.appLayout.classList.toggle('left-collapsed', !this.isLeftSidebarVisible);
    this.appLayout.classList.toggle('right-collapsed', !this.isRightSidebarVisible);

    this.updateSidebarToggleButton(
      'btn-toggle-left-sidebar',
      this.isLeftSidebarVisible,
      '左サイドバー',
      '◀',
      '▶',
    );
    this.updateSidebarToggleButton(
      'btn-toggle-right-sidebar',
      this.isRightSidebarVisible,
      '右サイドバー',
      '▶',
      '◀',
    );

    window.electronAPI.setSidebarVisibility(this.isLeftSidebarVisible, this.isRightSidebarVisible)
      .catch(() => this.showToast('サイドバーの表示を更新できませんでした', 'error'));
  }

  private updateSidebarToggleButton(
    id: string,
    isVisible: boolean,
    label: string,
    visibleIcon: string,
    hiddenIcon: string,
  ): void {
    const button = document.getElementById(id) as HTMLButtonElement;
    const action = isVisible ? '閉じる' : '開く';
    button.textContent = isVisible ? visibleIcon : hiddenIcon;
    button.title = `${label}を${action}`;
    button.setAttribute('aria-label', `${label}を${action}`);
    button.setAttribute('aria-expanded', String(isVisible));
  }

  private setWorkspace(workspace: Workspace): void {
    const isPlaylist = workspace === 'playlist';
    this.playlistCenterPanel.style.display = isPlaylist ? 'block' : 'none';
    this.sharedCenterPanel.style.display = isPlaylist ? 'none' : 'block';

    document.querySelectorAll<HTMLButtonElement>('.workspace-tab').forEach((tab) => {
      const active = tab.dataset.workspace === workspace;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', String(active));
    });

    const sortButton = document.getElementById('btn-sort') as HTMLButtonElement | null;
    if (sortButton) {
      sortButton.disabled = isPlaylist;
      sortButton.title = isPlaylist ? '共有楽曲キューで並び替えできます' : '共有キューを並び替える';
    }
    if (isPlaylist) {
      document.getElementById('sort-menu')?.classList.remove('open');
    }
  }

  private setCenterTab(tabName: CenterTab): void {
    document.querySelectorAll<HTMLButtonElement>('#center-tabs .tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    (document.getElementById('queue-panel') as HTMLElement).style.display = tabName === 'queue' ? 'block' : 'none';
    (document.getElementById('history-panel') as HTMLElement).style.display = tabName === 'history' ? 'block' : 'none';
    (document.getElementById('search-panel') as HTMLElement).style.display = tabName === 'search' ? 'block' : 'none';
  }

  private handleRoomJoined(room: Room, user: User): void {
    this.currentRoom = room;
    this.currentUser = user;
    this.syncEngine.setRoom(room, user);

    this.sidebarRoomName.textContent = room.name;
    this.sidebarRoomId.textContent = room.id;
    this.roomEntry.style.display = 'none';
    this.roomDetails.style.display = 'flex';
    this.btnCopyRoomId.disabled = false;
    this.btnLeaveRoom.disabled = false;

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

    this.sidebarRoomName.textContent = 'ルーム';
    this.sidebarRoomId.textContent = '------';
    this.roomEntry.style.display = 'block';
    this.roomDetails.style.display = 'none';
    this.btnCopyRoomId.disabled = true;
    this.btnLeaveRoom.disabled = true;
    this.queuePanel.setQueue([]);
    this.historyPanel.setHistory([]);
    this.membersPanel.setMembers([], '');
    this.playerControl.setRoom(null, null);

    this.showToast('ルームから退出しました', 'info');
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

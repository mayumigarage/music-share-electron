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
import { FAVORITES_PLAYLIST_ID, PlaylistStore } from './playlist-store.js';
import { AudioSearchPanel } from './audio-search-panel.js';
import { isIconName, setIcon, setIconButton, type IconName } from './icons.js';
import { openTrackOnYouTube } from './track-links.js';
import { RoomMode, RoomPlayerType } from '../../shared/models.js';
import type { PlaylistImportResult } from '../../shared/preload-api.js';
import type {
  Playlist,
  PlaylistTrack,
  Room,
  User,
  Track,
  PlayerState,
  TrackHistory,
} from '../../shared/models.js';

type Workspace = 'playlist' | 'queue';
type CenterTab = 'queue' | 'history' | 'search';
type TrackSort = 'title-asc' | 'title-desc' | 'duration-asc' | 'duration-desc' | 'member-round-robin' | 'added-newest' | 'added-oldest';

const LOCAL_PLAYLIST_PLAYER_TYPE_KEY = 'musicshare:playlist-player-type:v1';

function formatLogPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2);
}

function formatCommandArgv(argv: string[]): string {
  return argv.map((arg) => {
    if (!/[\s"]/.test(arg)) return arg;
    return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }).join(' ');
}

export class AppUI {
  private playlistPanel: PlaylistPanel;
  private queuePanel: QueuePanel;
  private historyPanel: HistoryPanel;
  private membersPanel: MembersPanel;
  private playerControl: PlayerControl;
  private audioSearchPanel: AudioSearchPanel;
  private playlistStore = new PlaylistStore();

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
  private playlistCenterDescription = document.getElementById('playlist-center-description') as HTMLElement;
  private playlistHeroCover = document.getElementById('playlist-hero-cover') as HTMLElement;
  private playlistList = document.getElementById('playlist-track-list') as HTMLElement;
  private playlistPlayerTypeSelect = document.getElementById('select-playlist-player-type') as HTMLSelectElement;
  private playlistSortSelect = document.getElementById('select-playlist-sort') as HTMLSelectElement;
  private btnPlayPlaylist = document.getElementById('btn-play-playlist') as HTMLButtonElement;
  private btnRenamePlaylist = document.getElementById('btn-rename-playlist') as HTMLButtonElement;
  private btnDeletePlaylist = document.getElementById('btn-delete-playlist') as HTMLButtonElement;
  private playlistModalOverlay = document.getElementById('modal-overlay-playlist') as HTMLElement;
  private playlistModalTitle = document.getElementById('playlist-modal-title') as HTMLElement;
  private playlistModalMessage = document.getElementById('playlist-modal-message') as HTMLElement;
  private playlistModalInputGroup = document.getElementById('playlist-modal-input-group') as HTMLElement;
  private playlistModalInput = document.getElementById('input-playlist-name') as HTMLInputElement;
  private playlistModalSelectGroup = document.getElementById('playlist-modal-select-group') as HTMLElement;
  private playlistModalSelect = document.getElementById('select-playlist-target') as HTMLSelectElement;
  private btnPlaylistModalCancel = document.getElementById('btn-playlist-modal-cancel') as HTMLButtonElement;
  private btnPlaylistModalSubmit = document.getElementById('btn-playlist-modal-submit') as HTMLButtonElement;
  private playlistImportOverlay = document.getElementById('modal-overlay-import-playlist') as HTMLElement;
  private playlistImportInput = document.getElementById('input-playlist-import-url') as HTMLInputElement;
  private playlistImportStatus = document.getElementById('playlist-import-status') as HTMLElement;
  private btnPlaylistImportCancel = document.getElementById('btn-playlist-import-cancel') as HTMLButtonElement;
  private btnPlaylistImportSubmit = document.getElementById('btn-playlist-import-submit') as HTMLButtonElement;
  private sidebarRoomName = document.getElementById('sidebar-room-name') as HTMLElement;
  private sidebarRoomId = document.getElementById('sidebar-room-id') as HTMLElement;
  private btnCopyRoomId = document.getElementById('btn-copy-room-id') as HTMLButtonElement;
  private btnLeaveRoom = document.getElementById('btn-leave-room') as HTMLButtonElement;
  private roomEntry = document.getElementById('room-entry') as HTMLElement;
  private roomDetails = document.getElementById('room-details') as HTMLElement;
  private appLayout = document.getElementById('app-layout') as HTMLElement;
  private isLeftSidebarVisible = true;
  private isRightSidebarVisible = true;
  private currentWorkspace: Workspace = 'queue';
  private selectedPlaylistId = FAVORITES_PLAYLIST_ID;
  private playlistDragSrcIndex: number | null = null;
  private playlistDialogResolve: ((value: string | boolean | null) => void) | null = null;
  private playlistDialogMode: 'name' | 'confirm' | 'select' = 'name';
  private localPlaylistPlayerType = this.loadLocalPlaylistPlayerType();
  private localPlayingTrackId: string | null = null;

  constructor(
    private wsClient: WebSocketClient,
    private syncEngine: SyncEngine,
    private playerProxy: PlayerProxy,
  ) {
    this.playlistPanel = new PlaylistPanel(
      this.handleCreatePlaylist.bind(this),
      this.openPlaylistImportDialog.bind(this),
    );
    this.queuePanel = new QueuePanel(
      wsClient,
      this.showToast.bind(this),
      this.playlistStore,
      this.openPlaylistTargetDialog.bind(this),
      this.renderPlaylistWorkspace.bind(this),
    );
    this.historyPanel = new HistoryPanel();
    this.membersPanel = new MembersPanel();
    this.playerControl = new PlayerControl(playerProxy, wsClient, syncEngine);
    this.playerControl.onLocalPlayerStateUpdated = (state) => this.handleLocalPlayerStateUpdated(state);
    this.audioSearchPanel = new AudioSearchPanel(this.showToast.bind(this));
  }

  async init(): Promise<void> {
    await this.playlistStore.initialize();

    // Keep this in the renderer so logs appear in the detached DevTools Console.
    // Code points make mojibake distinguishable from a DevTools display issue.
    window.electronAPI.onTrackResolverDebug((log) => {
      if (log.stage === 'spotify-web-api') {
        console.log(`[TrackResolver][${log.stage}] ${formatLogPayload({
          sourceUrl: log.sourceUrl,
          title: log.title,
          artist: log.artist,
          details: log.details,
        })}`);
        return;
      }

      if (log.stage === 'spotify-metadata') {
        console.log(`[TrackResolver][Spotify metadata] ${formatLogPayload({
          sourceUrl: log.sourceUrl,
          title: log.title,
          artist: log.artist,
          titleCodePoints: log.titleCodePoints,
          artistCodePoints: log.artistCodePoints,
        })}`);
        return;
      }

      const commandArgv = ['yt-dlp', ...(log.ytDlpArgs || [])];
      console.log(`[TrackResolver][yt-dlp command] ${formatLogPayload({
        sourceUrl: log.sourceUrl,
        candidate: log.candidateType,
        searchQuery: log.searchQuery,
        // execFile passes an argv array (not a shell command string), so this
        // is the exact argument sequence delivered to yt-dlp.
        command: formatCommandArgv(commandArgv),
        argv: commandArgv,
      })}`);
    });

    this.bindGlobalEvents();
    this.bindTopBar();
    this.bindRightSidebar();
    this.bindSidebarToggles();
    this.bindPlaylistModal();
    this.bindPlaylistImportModal();
    this.bindPlaylistPlaybackSettings();
    this.bindPlaylistSort();

    this.playlistPanel.init();
    this.queuePanel.init();
    this.historyPanel.init();
    this.membersPanel.init();
    this.playerControl.init();
    this.audioSearchPanel.init();
    this.renderPlaylistWorkspace();
    this.setWorkspace('queue');

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
    this.wsClient.onQueueUpdated = (queue) => {
      if (this.currentRoom) {
        this.currentRoom.queue = queue;
      }
      this.queuePanel.setQueue(queue);
      this.syncEngine.refreshUpcomingTrackPreload();
      void this.reconcilePlayerStateWithQueue(queue);
    };
    this.wsClient.onTrackAdded = (track) => {
      this.showToast(`「${track.title}」が追加されました`, 'success');
    };
    this.wsClient.onHistoryUpdated = (history) => {
      if (this.currentRoom) {
        this.currentRoom.history = history;
      }
      this.historyPanel.setHistory(history);
    };
    this.wsClient.onPlayerStateUpdated = (state) => {
      if (this.isStalePlayerState(state)) {
        console.warn('[AppUI] Ignored stale player state for a track outside the queue:', state.currentTrack?.id);
        return;
      }
      this.handlePlayerStateUpdated(state);
      void this.syncEngine.handlePlayerStateUpdated(state);
    };
    this.syncEngine.onHostPlayerStateObserved = (state) => {
      if (this.isStalePlayerState(state)) {
        console.warn('[AppUI] Ignored stale local player state for a track outside the queue:', state.currentTrack?.id);
        return;
      }
      this.handlePlayerStateUpdated(state);
    };
    this.wsClient.onError = (code, message) => {
      if (code === 'JOIN_FAILED') {
        this.showToast('ルームに参加できませんでした', 'error');
        return;
      }
      this.showToast(message, 'error');
    };

    // Player errors are shown to the user; they never change the queue automatically.
    this.syncEngine.onPlayerError = (errorDetail) => {
      console.error('[AppUI] Player error detail:', errorDetail);
      const friendlyMessage = this.resolvePlayerErrorMessage(errorDetail);
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

  /** Translate low-level player error strings into user-friendly messages. */
  private resolvePlayerErrorMessage(errorDetail: string): string | null {
    const lower = errorDetail.toLowerCase();
    // YouTube IFrame Player errors
    if (lower.includes('youtube player error: 153')) {
      return 'YouTube が埋め込みプレイヤーを識別できませんでした。もう一度再生してください。';
    }
    if (lower.includes('youtube player error: 150') || lower.includes('youtube player error: 151')) {
      return 'この動画は埋め込み再生に対応していません。';
    }
    if (lower.includes('youtube player error: 100')) {
      return '動画が見つからないか、削除されています。';
    }
    if (lower.includes('youtube player error: 5')) {
      return 'HTML5 プレイヤーでこの動画を再生できません。';
    }
    // Spotify errors
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
      const sort = this.toTrackSort(item.dataset.sort);
      if (sort && this.currentWorkspace === 'queue' && this.isQueueSort(sort)) {
        this.queuePanel.sortQueue(sort);
        this.showToast(
          sort === 'member-round-robin'
            ? 'メンバーごとに1曲ずつ再生される順番に更新しました'
            : '共有キューの並び順を更新しました',
          'success',
        );
      } else if (sort && this.currentWorkspace === 'playlist' && this.isPlaylistSort(sort)) {
        this.sortSelectedPlaylist(sort);
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

    this.btnPlayPlaylist.addEventListener('click', () => this.handlePlaySelectedPlaylist());
    this.btnRenamePlaylist.addEventListener('click', () => this.handleRenamePlaylist());
    this.btnDeletePlaylist.addEventListener('click', () => this.handleDeletePlaylist());

    window.addEventListener('musicshare:playlist-selected', (event) => {
      const { id } = (event as CustomEvent<{ id: string; name: string; icon: string }>).detail;
      this.selectPlaylist(id);
    });
  }

  private selectPlaylist(playlistId: string): void {
    const playlist = this.playlistStore.getPlaylist(playlistId);
    if (!playlist) return;

    this.selectedPlaylistId = playlist.id;
    this.renderPlaylistWorkspace();
    this.setWorkspace('playlist');
  }

  private renderPlaylistWorkspace(): void {
    if (!this.playlistStore.getPlaylist(this.selectedPlaylistId)) {
      this.selectedPlaylistId = FAVORITES_PLAYLIST_ID;
    }

    this.playlistPanel.render(this.playlistStore.getPlaylists(), this.selectedPlaylistId);
    this.renderSelectedPlaylist();
  }

  private renderSelectedPlaylist(): void {
    const playlist = this.playlistStore.getPlaylist(this.selectedPlaylistId)
      ?? this.playlistStore.getPlaylist(FAVORITES_PLAYLIST_ID);
    if (!playlist) return;

    this.playlistCenterTitle.textContent = playlist.name;
    this.playlistCenterDescription.textContent = this.getPlaylistDescription(playlist);
    this.setPlaylistHeroIcon(playlist.icon);

    const canManage = this.playlistStore.canManagePlaylist(playlist.id);
    this.btnPlayPlaylist.disabled = playlist.tracks.length === 0;
    this.btnRenamePlaylist.disabled = !canManage;
    this.btnDeletePlaylist.disabled = !canManage;

    this.playlistList.replaceChildren();
    if (playlist.tracks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'このプレイリストにはまだ曲がありません';
      this.playlistList.appendChild(empty);
      return;
    }

    const canEditTracks = this.playlistStore.isWritablePlaylist(playlist.id);
    playlist.tracks.forEach((track, index) => {
      this.playlistList.appendChild(this.createPlaylistTrackElement(playlist, track, index, canEditTracks));
    });
  }

  private createPlaylistTrackElement(
    playlist: Playlist,
    track: PlaylistTrack,
    index: number,
    canEditTracks: boolean,
  ): HTMLElement {
    const item = document.createElement('div');
    item.className = 'track-item';
    item.classList.toggle('is-playing', this.localPlayingTrackId === track.id);
    item.dataset.trackId = track.id;
    item.dataset.trackKey = this.playlistStore.getTrackKey(track);
    item.dataset.index = String(index);
    item.draggable = canEditTracks;

    const thumb = document.createElement('img');
    thumb.className = 'track-thumb';
    thumb.src = track.thumbnailUrl || '';
    thumb.alt = '';
    if (!track.thumbnailUrl) {
      thumb.style.background = '#333';
    }

    const info = document.createElement('div');
    info.className = 'track-info';
    const title = document.createElement('div');
    title.className = 'track-title';
    title.textContent = track.title;
    const artist = document.createElement('div');
    artist.className = 'track-meta';
    artist.textContent = `${track.artist}${this.formatSavedAt(track.addedAt)}`;
    info.append(title, artist);

    const actions = document.createElement('div');
    actions.className = 'track-actions';

    const playBtn = document.createElement('button');
    setIconButton(playBtn, 'play-solid', 'この曲から再生', { size: 18 });
    playBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.playPlaylistFrom(playlist, index);
    });
    actions.appendChild(playBtn);

    const addQueueBtn = document.createElement('button');
    setIconButton(addQueueBtn, 'queue-list', '共有キューに追加', { size: 18 });
    addQueueBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this.addPlaylistTrackToQueue(track);
    });
    actions.appendChild(addQueueBtn);

    if (canEditTracks) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'track-delete';
      setIconButton(removeBtn, 'trash', 'プレイリストから削除', { size: 18 });
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.playlistStore.removeTrack(playlist.id, this.playlistStore.getTrackKey(track));
        this.showToast('プレイリストから削除しました', 'success');
        this.renderPlaylistWorkspace();
      });
      actions.appendChild(removeBtn);

      item.addEventListener('dragstart', (event) => {
        this.playlistDragSrcIndex = index;
        item.classList.add('dragging');
        event.dataTransfer?.setData('text/plain', String(index));
        event.dataTransfer!.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        this.playlistDragSrcIndex = null;
        item.classList.remove('dragging');
        this.playlistList.querySelectorAll('.track-item').forEach((element) => element.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer!.dropEffect = 'move';
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        item.classList.remove('drag-over');
        const srcIndex = this.playlistDragSrcIndex;
        if (srcIndex === null || srcIndex === index) return;

        const newOrder = playlist.tracks.map((playlistTrack) => this.playlistStore.getTrackKey(playlistTrack));
        const [moved] = newOrder.splice(srcIndex, 1);
        newOrder.splice(index, 0, moved);
        if (this.playlistStore.reorderTracks(playlist.id, newOrder)) {
          this.renderPlaylistWorkspace();
        }
      });
    }

    item.addEventListener('dblclick', () => {
      openTrackOnYouTube(track);
    });

    item.append(thumb, info, actions);
    return item;
  }

  private async handleCreatePlaylist(): Promise<void> {
    const name = await this.openPlaylistNameDialog('新しいプレイリスト', '', '作成');
    const trimmed = name?.trim();
    if (!trimmed) return;

    const playlist = this.playlistStore.createPlaylist(trimmed);
    this.selectedPlaylistId = playlist.id;
    this.renderPlaylistWorkspace();
    this.setWorkspace('playlist');
    this.showToast(`「${playlist.name}」を作成しました`, 'success');
  }

  private bindPlaylistImportModal(): void {
    this.btnPlaylistImportCancel.addEventListener('click', () => this.closePlaylistImportDialog());
    this.btnPlaylistImportSubmit.addEventListener('click', () => {
      void this.handleImportPlaylist();
    });
    this.playlistImportOverlay.addEventListener('click', (event) => {
      if (event.target === this.playlistImportOverlay && !this.btnPlaylistImportSubmit.disabled) {
        this.closePlaylistImportDialog();
      }
    });
    this.playlistImportInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.handleImportPlaylist();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape'
        && this.playlistImportOverlay.style.display !== 'none'
        && !this.btnPlaylistImportSubmit.disabled) {
        this.closePlaylistImportDialog();
      }
    });
  }

  private openPlaylistImportDialog(): void {
    this.playlistImportInput.value = '';
    this.playlistImportStatus.textContent = '';
    this.playlistImportStatus.style.display = 'none';
    this.playlistImportStatus.style.color = 'var(--text-secondary)';
    this.btnPlaylistImportSubmit.disabled = false;
    this.btnPlaylistImportCancel.disabled = false;
    this.btnPlaylistImportSubmit.textContent = 'インポート';
    this.playlistImportOverlay.style.display = 'flex';
    window.setTimeout(() => this.playlistImportInput.focus(), 0);
  }

  private closePlaylistImportDialog(): void {
    this.playlistImportOverlay.style.display = 'none';
  }

  private async handleImportPlaylist(): Promise<void> {
    const url = this.playlistImportInput.value.trim();
    if (!url) {
      this.showPlaylistImportStatus('URLを入力してください', true);
      this.playlistImportInput.focus();
      return;
    }

    this.btnPlaylistImportSubmit.disabled = true;
    this.btnPlaylistImportCancel.disabled = true;
    this.btnPlaylistImportSubmit.textContent = '取り込み中...';
    this.showPlaylistImportStatus('取り込み中...');

    try {
      const result = await window.electronAPI.importPlaylist(url);
      await this.createPlaylistFromImport(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showPlaylistImportStatus(message, true);
      this.showToast(message, 'error');
      if (message.includes('Spotify')) {
        this.showSpotifyAuthRequested = true;
        await this.refreshSpotifyAuthStatus();
      }
    } finally {
      if (this.playlistImportOverlay.style.display !== 'none') {
        this.btnPlaylistImportSubmit.disabled = false;
        this.btnPlaylistImportCancel.disabled = false;
        this.btnPlaylistImportSubmit.textContent = 'インポート';
      }
    }
  }

  private async createPlaylistFromImport(result: PlaylistImportResult): Promise<void> {
    if (result.tracks.length === 0) {
      this.showPlaylistImportStatus('取り込める曲がありませんでした。', true);
      this.showToast('取り込める曲がありませんでした', 'error');
      return;
    }

    const playlistName = this.getUniquePlaylistName(result.title || 'インポートしたプレイリスト');
    const playlist = this.playlistStore.createPlaylist(playlistName);
    const tracks: Track[] = result.tracks.map((track) => ({
      ...track,
      id: this.createTrackId(),
      addedBy: '',
    }));
    const added = this.playlistStore.addTracks(playlist.id, tracks);
    if (added.missing || added.added === 0) {
      this.playlistStore.deletePlaylist(playlist.id);
      this.showPlaylistImportStatus('プレイリストに保存できませんでした。', true);
      this.showToast('プレイリストに保存できませんでした', 'error');
      return;
    }

    this.selectedPlaylistId = playlist.id;
    this.closePlaylistImportDialog();
    this.renderPlaylistWorkspace();
    this.setWorkspace('playlist');
    this.showToast(this.getPlaylistImportToast(result, added.added, added.duplicate), 'success');
  }

  private showPlaylistImportStatus(message: string, isError = false): void {
    this.playlistImportStatus.textContent = message;
    this.playlistImportStatus.style.color = isError ? 'var(--danger)' : 'var(--text-secondary)';
    this.playlistImportStatus.style.display = 'block';
  }

  private getUniquePlaylistName(name: string): string {
    const baseName = name.trim().slice(0, 80) || 'インポートしたプレイリスト';
    const existingNames = new Set(this.playlistStore.getPlaylists().map((playlist) => playlist.name));
    if (!existingNames.has(baseName)) return baseName;

    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${baseName} (${index})`;
      if (!existingNames.has(candidate)) return candidate;
    }
    return `${baseName} (${Date.now()})`;
  }

  private getPlaylistImportToast(result: PlaylistImportResult, addedCount: number, duplicateCount: number): string {
    const notes: string[] = [`${addedCount}曲をインポートしました`];
    if (duplicateCount > 0) notes.push(`${duplicateCount}曲は重複をスキップ`);
    if (result.skippedCount > 0) notes.push(`${result.skippedCount}曲は取得不可`);
    if (result.unresolvedCount > 0) notes.push(`${result.unresolvedCount}曲は再生候補未解決`);
    if (result.isPartial) notes.push('上限まで取り込み');
    return notes.join(' / ');
  }

  private handlePlaySelectedPlaylist(): void {
    const playlist = this.playlistStore.getPlaylist(this.selectedPlaylistId);
    if (!playlist) return;
    void this.playPlaylistFrom(playlist, 0);
  }

  private async playPlaylistFrom(playlist: Playlist, startIndex: number): Promise<void> {
    if (playlist.tracks.length === 0) {
      this.showToast('プレイリストに曲がありません', 'info');
      return;
    }
    if (this.currentRoom) {
      this.showToast('ルーム参加中は共有キューで再生してください', 'info');
      return;
    }

    this.playerControl.setLocalPlaylistPlayerType(this.localPlaylistPlayerType);
    await this.playerControl.playLocalPlaylist(playlist.tracks, startIndex, this.localPlaylistPlayerType);
    this.setWorkspace('playlist');
  }

  private async handleRenamePlaylist(): Promise<void> {
    const playlist = this.playlistStore.getPlaylist(this.selectedPlaylistId);
    if (!playlist || !this.playlistStore.canManagePlaylist(playlist.id)) return;

    const name = await this.openPlaylistNameDialog('名前を変更', playlist.name, '保存');
    const trimmed = name?.trim();
    if (!trimmed || trimmed === playlist.name) return;

    if (this.playlistStore.renamePlaylist(playlist.id, trimmed)) {
      this.renderPlaylistWorkspace();
      this.showToast('プレイリスト名を変更しました', 'success');
    }
  }

  private async handleDeletePlaylist(): Promise<void> {
    const playlist = this.playlistStore.getPlaylist(this.selectedPlaylistId);
    if (!playlist || !this.playlistStore.canManagePlaylist(playlist.id)) return;

    const confirmed = await this.openPlaylistConfirmDialog(
      'プレイリストを削除',
      `「${playlist.name}」を削除しますか？`,
      '削除',
    );
    if (!confirmed) return;

    if (this.playlistStore.deletePlaylist(playlist.id)) {
      this.selectedPlaylistId = FAVORITES_PLAYLIST_ID;
      this.renderPlaylistWorkspace();
      this.showToast('プレイリストを削除しました', 'success');
    }
  }

  private addPlaylistTrackToQueue(track: Track): void {
    if (!this.currentRoom) {
      this.showToast('ルームに参加すると共有キューに追加できます', 'info');
      return;
    }

    this.wsClient.addTrack({
      ...track,
      id: this.createTrackId(),
      addedBy: '',
    });
    this.showToast('共有キューに追加しました', 'success');
  }

  private getPlaylistDescription(playlist: Playlist): string {
    return `${playlist.tracks.length}曲を保存中`;
  }

  private sortSelectedPlaylist(sort: TrackSort): void {
    const playlist = this.playlistStore.getPlaylist(this.selectedPlaylistId);
    if (!playlist || playlist.tracks.length < 2) return;

    const direction = sort.endsWith('desc') ? -1 : 1;
    const sorted = [...playlist.tracks].sort((a, b) => {
      if (sort === 'duration-asc' || sort === 'duration-desc') {
        return ((a.durationSeconds ?? Number.MAX_SAFE_INTEGER) - (b.durationSeconds ?? Number.MAX_SAFE_INTEGER)) * direction;
      }
      if (sort === 'added-newest') {
        return b.addedAt - a.addedAt;
      }
      if (sort === 'added-oldest') {
        return a.addedAt - b.addedAt;
      }
      return a.title.localeCompare(b.title, 'ja') * direction;
    });

    if (this.playlistStore.reorderTracks(playlist.id, sorted.map((track) => this.playlistStore.getTrackKey(track)))) {
      this.renderPlaylistWorkspace();
      this.showToast('プレイリストの並び順を更新しました', 'success');
    }
  }

  private toTrackSort(sort: string | undefined): TrackSort | null {
    if (
      sort === 'title-asc' ||
      sort === 'title-desc' ||
      sort === 'duration-asc' ||
      sort === 'duration-desc' ||
      sort === 'member-round-robin' ||
      sort === 'added-newest' ||
      sort === 'added-oldest'
    ) {
      return sort;
    }
    return null;
  }

  private isQueueSort(sort: TrackSort): sort is 'title-asc' | 'title-desc' | 'duration-asc' | 'duration-desc' | 'member-round-robin' {
    return sort !== 'added-newest' && sort !== 'added-oldest';
  }

  private isPlaylistSort(sort: TrackSort): sort is 'title-asc' | 'title-desc' | 'duration-asc' | 'duration-desc' | 'added-newest' | 'added-oldest' {
    return sort !== 'member-round-robin';
  }

  private bindPlaylistPlaybackSettings(): void {
    this.playlistPlayerTypeSelect.value = this.localPlaylistPlayerType;
    this.playerControl.setLocalPlaylistPlayerType(this.localPlaylistPlayerType);
    this.playlistPlayerTypeSelect.addEventListener('change', () => {
      this.localPlaylistPlayerType = this.playlistPlayerTypeSelect.value === RoomPlayerType.HtmlVideo
        ? RoomPlayerType.HtmlVideo
        : RoomPlayerType.YouTube;
      this.playerControl.setLocalPlaylistPlayerType(this.localPlaylistPlayerType);
      try {
        window.localStorage.setItem(LOCAL_PLAYLIST_PLAYER_TYPE_KEY, this.localPlaylistPlayerType);
      } catch {
        // The setting still applies for the current session.
      }
    });
  }

  private bindPlaylistSort(): void {
    this.playlistSortSelect.addEventListener('change', () => {
      const sort = this.toTrackSort(this.playlistSortSelect.value);
      if (sort && this.isPlaylistSort(sort)) {
        this.sortSelectedPlaylist(sort);
      }
      this.playlistSortSelect.value = '';
    });
  }

  private loadLocalPlaylistPlayerType(): RoomPlayerType {
    try {
      return window.localStorage.getItem(LOCAL_PLAYLIST_PLAYER_TYPE_KEY) === RoomPlayerType.HtmlVideo
        ? RoomPlayerType.HtmlVideo
        : RoomPlayerType.YouTube;
    } catch {
      return RoomPlayerType.YouTube;
    }
  }

  private bindPlaylistModal(): void {
    this.btnPlaylistModalCancel.addEventListener('click', () => this.closePlaylistDialog(null));
    this.btnPlaylistModalSubmit.addEventListener('click', () => this.submitPlaylistDialog());
    this.playlistModalOverlay.addEventListener('click', (event) => {
      if (event.target === this.playlistModalOverlay) {
        this.closePlaylistDialog(null);
      }
    });
    this.playlistModalInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.submitPlaylistDialog();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.playlistModalOverlay.style.display !== 'none') {
        this.closePlaylistDialog(null);
      }
    });
  }

  private openPlaylistNameDialog(title: string, initialValue: string, submitLabel: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.playlistDialogResolve = (value) => resolve(typeof value === 'string' ? value : null);
      this.playlistDialogMode = 'name';
      this.playlistModalTitle.textContent = title;
      this.playlistModalMessage.textContent = '';
      this.playlistModalMessage.style.display = 'none';
      this.playlistModalInputGroup.style.display = 'flex';
      this.playlistModalSelectGroup.style.display = 'none';
      this.playlistModalInput.value = initialValue;
      this.btnPlaylistModalSubmit.textContent = submitLabel;
      this.btnPlaylistModalSubmit.classList.remove('btn-danger');
      this.btnPlaylistModalSubmit.classList.add('btn-primary');
      this.playlistModalOverlay.style.display = 'flex';
      window.setTimeout(() => {
        this.playlistModalInput.focus();
        this.playlistModalInput.select();
      }, 0);
    });
  }

  private openPlaylistConfirmDialog(title: string, message: string, submitLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.playlistDialogResolve = (value) => resolve(value === true);
      this.playlistDialogMode = 'confirm';
      this.playlistModalTitle.textContent = title;
      this.playlistModalMessage.textContent = message;
      this.playlistModalMessage.style.display = 'block';
      this.playlistModalInputGroup.style.display = 'none';
      this.playlistModalSelectGroup.style.display = 'none';
      this.playlistModalInput.value = '';
      this.btnPlaylistModalSubmit.textContent = submitLabel;
      this.btnPlaylistModalSubmit.classList.remove('btn-primary');
      this.btnPlaylistModalSubmit.classList.add('btn-danger');
      this.playlistModalOverlay.style.display = 'flex';
      this.btnPlaylistModalCancel.focus();
    });
  }

  private openPlaylistTargetDialog(track: Track): Promise<string | null> {
    return new Promise((resolve) => {
      const playlists = this.playlistStore.getEditablePlaylists()
        .filter((playlist) => this.playlistStore.isWritablePlaylist(playlist.id));
      if (playlists.length === 0) {
        resolve(null);
        return;
      }

      this.playlistDialogResolve = (value) => resolve(typeof value === 'string' ? value : null);
      this.playlistDialogMode = 'select';
      this.playlistModalTitle.textContent = 'プレイリストに追加';
      this.playlistModalMessage.textContent = `「${track.title}」の保存先を選択してください。`;
      this.playlistModalMessage.style.display = 'block';
      this.playlistModalInputGroup.style.display = 'none';
      this.playlistModalSelectGroup.style.display = 'flex';
      this.playlistModalSelect.replaceChildren();

      playlists.forEach((playlist) => {
        const option = document.createElement('option');
        option.value = playlist.id;
        option.textContent = playlist.name;
        this.playlistModalSelect.appendChild(option);
      });

      const preferredPlaylistId = this.playlistStore.isWritablePlaylist(this.selectedPlaylistId)
        ? this.selectedPlaylistId
        : FAVORITES_PLAYLIST_ID;
      this.playlistModalSelect.value = preferredPlaylistId;
      this.btnPlaylistModalSubmit.textContent = '追加';
      this.btnPlaylistModalSubmit.classList.remove('btn-danger');
      this.btnPlaylistModalSubmit.classList.add('btn-primary');
      this.playlistModalOverlay.style.display = 'flex';
      this.playlistModalSelect.focus();
    });
  }

  private submitPlaylistDialog(): void {
    if (this.playlistDialogMode === 'confirm') {
      this.closePlaylistDialog(true);
      return;
    }
    if (this.playlistDialogMode === 'select') {
      this.closePlaylistDialog(this.playlistModalSelect.value || null);
      return;
    }

    const value = this.playlistModalInput.value.trim();
    if (!value) {
      this.showToast('プレイリスト名を入力してください', 'error');
      this.playlistModalInput.focus();
      return;
    }

    this.closePlaylistDialog(value);
  }

  private closePlaylistDialog(value: string | boolean | null): void {
    this.playlistModalOverlay.style.display = 'none';
    const resolve = this.playlistDialogResolve;
    this.playlistDialogResolve = null;
    resolve?.(value);
  }

  private formatSavedAt(addedAt: number): string {
    if (!Number.isFinite(addedAt)) return '';
    return ` ・ ${new Date(addedAt).toLocaleDateString('ja-JP')}`;
  }

  private createTrackId(): string {
    return `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      const playerTypeInput = document.getElementById('select-sidebar-player-type') as HTMLSelectElement | null;
      const playerType = playerTypeInput?.value === RoomPlayerType.HtmlVideo
        ? RoomPlayerType.HtmlVideo
        : RoomPlayerType.YouTube;
      if (!roomName || !userName) {
        this.showToast('ルーム名とあなたの名前を入力してください', 'error');
        return;
      }
      this.wsClient.createRoom(roomName, userName, RoomMode.Individual, playerType);
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
      'chevron-left',
      'chevron-right',
    );
    this.updateSidebarToggleButton(
      'btn-toggle-right-sidebar',
      this.isRightSidebarVisible,
      '右サイドバー',
      'chevron-right',
      'chevron-left',
    );

    window.electronAPI.setSidebarVisibility(this.isLeftSidebarVisible, this.isRightSidebarVisible)
      .catch(() => this.showToast('サイドバーの表示を更新できませんでした', 'error'));
  }

  private updateSidebarToggleButton(
    id: string,
    isVisible: boolean,
    label: string,
    visibleIcon: IconName,
    hiddenIcon: IconName,
  ): void {
    const button = document.getElementById(id) as HTMLButtonElement;
    const action = isVisible ? '閉じる' : '開く';
    setIconButton(button, isVisible ? visibleIcon : hiddenIcon, `${label}を${action}`);
    button.setAttribute('aria-expanded', String(isVisible));
  }

  private setPlaylistHeroIcon(icon: string): void {
    const iconName = isIconName(icon) ? icon : 'musical-note';
    this.playlistHeroCover.dataset.playlistIcon = iconName;
    setIcon(this.playlistHeroCover, iconName, { size: 24 });
  }

  private setWorkspace(workspace: Workspace): void {
    this.currentWorkspace = workspace;
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
      sortButton.disabled = false;
      sortButton.title = isPlaylist ? 'プレイリストを並び替える' : '共有キューを並び替える';
    }
    document.querySelectorAll<HTMLButtonElement>('#sort-menu [data-sort-scope]').forEach((item) => {
      const scope = item.dataset.sortScope;
      item.style.display = scope === 'all' || scope === workspace ? 'block' : 'none';
    });
    document.getElementById('sort-menu')?.classList.remove('open');
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
    room.playerType ??= RoomPlayerType.YouTube;
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
    this.localPlayingTrackId = null;
    this.queuePanel.setPlayerState(state);
    this.playerControl.updateState(state);
    this.updateNowPlaying(state.currentTrack, state.isPlaying);
  }

  private handleLocalPlayerStateUpdated(state: PlayerState): void {
    this.localPlayingTrackId = state.currentTrack?.id ?? null;
    this.updateNowPlaying(state.currentTrack, state.isPlaying);
    this.setPlaylistPlayingTrack(this.localPlayingTrackId);
  }

  private async reconcilePlayerStateWithQueue(queue: Track[]): Promise<void> {
    if (!this.currentRoom?.playerState.currentTrack) return;
    if (queue.some((track) => track.id === this.currentRoom?.playerState.currentTrack?.id)) return;

    const nextTrack = queue[0] ?? null;
    const state: PlayerState = {
      ...this.currentRoom.playerState,
      currentTrack: nextTrack,
      isPlaying: nextTrack ? this.currentRoom.playerState.isPlaying : false,
      positionSeconds: 0,
      updatedAt: Date.now(),
    };
    await this.syncEngine.handlePlayerStateUpdated(state);
    this.handlePlayerStateUpdated(state);
  }

  private isStalePlayerState(state: PlayerState): boolean {
    if (!this.currentRoom || !state.currentTrack) return false;
    return !this.currentRoom.queue.some((track) => track.id === state.currentTrack?.id);
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
    setIconButton(playBtn, isPlaying ? 'pause-solid' : 'play-solid', isPlaying ? '一時停止' : '再生', { size: 20 });
    this.queuePanel.setPlayingTrack(track?.id ?? null);
  }

  private setPlaylistPlayingTrack(trackId: string | null): void {
    this.playlistList.querySelectorAll<HTMLElement>('.track-item').forEach((item) => {
      item.classList.toggle('is-playing', item.dataset.trackId === trackId);
    });
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

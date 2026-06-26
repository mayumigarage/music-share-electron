/**
 * MusicShare — Queue Panel (Center)
 * Phase 6: Queue rendering, drag-and-drop reorder, custom context menu, double-click open link.
 */

import type { WebSocketClient } from '../sync/websocket-client.js';
import { MusicServiceType, type LocalAudioSearchResult, type Track } from '../../shared/models.js';
import type { TrackSearchCandidate, YouTubeMusicCandidatesResult } from '../../shared/preload-api.js';
import '../../shared/preload-api.js';
import type { FavoritesStore } from './favorites-store.js';

type TrackAddMode = 'url' | 'spotify' | 'local';

export class QueuePanel {
  private queue: Track[] = [];
  private dragSrcIndex: number | null = null;

  private listEl = document.getElementById('queue-list') as HTMLElement;
  private countEl = document.getElementById('queue-count') as HTMLElement;
  private addBtn = document.getElementById('btn-add-track') as HTMLButtonElement | null;

  // Track add modal refs
  private trackOverlay = document.getElementById('modal-overlay-track') as HTMLElement;
  private modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-track-add-mode]'));
  private urlModePanel = document.getElementById('track-add-url-panel') as HTMLElement;
  private spotifyModePanel = document.getElementById('track-add-spotify-panel') as HTMLElement;
  private localModePanel = document.getElementById('track-add-local-panel') as HTMLElement;
  private trackUrlInput = document.getElementById('input-track-url') as HTMLInputElement;
  private trackSearchQueryInput = document.getElementById('input-track-search-query') as HTMLInputElement;
  private trackSpotifyUrlInput = document.getElementById('input-track-spotify-url') as HTMLInputElement;
  private trackSpotifySearchQueryInput = document.getElementById('input-track-spotify-search-query') as HTMLInputElement;
  private trackMediaIdInput = document.getElementById('input-track-media-id') as HTMLInputElement;
  private trackCandidates = document.getElementById('track-candidates') as HTMLElement;
  private spotifyTrackCandidates = document.getElementById('spotify-track-candidates') as HTMLElement;
  private spotifyLocalResults = document.getElementById('track-candidate-spotify-local') as HTMLElement;
  private localAudioPreview = document.getElementById('local-audio-preview') as HTMLElement;
  private btnResolve = document.getElementById('btn-track-resolve') as HTMLButtonElement;
  private btnSearch = document.getElementById('btn-track-search') as HTMLButtonElement;
  private btnSpotifySearch = document.getElementById('btn-track-spotify-search') as HTMLButtonElement;
  private btnAddPlaylist = document.getElementById('btn-track-add-playlist') as HTMLButtonElement;
  private btnAddQueue = document.getElementById('btn-track-add-queue') as HTMLButtonElement;

  private activeAddMode: TrackAddMode = 'url';
  private resolvedTrack: Track | null = null;
  private resolutionSequence = 0;
  private activeResolutionRequestId: string | null = null;
  private pendingYouTubeMusicResults = new Map<string, YouTubeMusicCandidatesResult>();

  constructor(
    private wsClient: WebSocketClient,
    private showToast: (msg: string, type?: 'info' | 'success' | 'error') => void,
    private favoritesStore: FavoritesStore,
    private onFavoritesChanged: () => void,
  ) {}

  init(): void {
    this.addBtn?.addEventListener('click', () => this.openAddModal());
    document.getElementById('btn-track-cancel')?.addEventListener('click', () => this.closeAddModal());
    this.modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const mode = this.toTrackAddMode(button.dataset.trackAddMode);
        this.setTrackAddMode(mode);
      });
    });
    this.btnResolve.addEventListener('click', () => {
      if (this.activeAddMode === 'local') {
        void this.resolveLocalAudio();
      } else if (this.activeAddMode === 'spotify') {
        void this.resolveSpotifyUrlToLocalSearch();
      } else {
        void this.resolveUrl();
      }
    });
    this.btnSearch.addEventListener('click', () => this.searchWithEditedQuery());
    this.btnSpotifySearch.addEventListener('click', () => {
      void this.searchSpotifyLocalWithEditedQuery();
    });
    this.btnAddQueue.addEventListener('click', () => this.addResolvedTrack());
    this.btnAddPlaylist.addEventListener('click', () => {
      this.showToast('プレイリストへの保存機能は今後追加されます', 'info');
    });
    window.electronAPI.onYouTubeMusicCandidates((result) => {
      if (result.requestId !== this.activeResolutionRequestId || this.trackOverlay.style.display === 'none') {
        this.pendingYouTubeMusicResults.set(result.requestId, result);
        while (this.pendingYouTubeMusicResults.size > 10) {
          const oldestRequestId = this.pendingYouTubeMusicResults.keys().next().value as string | undefined;
          if (!oldestRequestId) break;
          this.pendingYouTubeMusicResults.delete(oldestRequestId);
        }
        return;
      }
      this.renderCandidates('youtubeMusic', result.youtubeMusic);
    });
    this.trackUrlInput.addEventListener('input', () => this.clearSearchResults());
    this.trackSpotifyUrlInput.addEventListener('input', () => this.clearSearchResults());
    this.trackMediaIdInput.addEventListener('input', () => this.clearSearchResults());
    this.trackUrlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.resolveUrl();
      }
    });
    this.trackSearchQueryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.searchWithEditedQuery();
      }
    });
    this.trackSpotifyUrlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.resolveSpotifyUrlToLocalSearch();
      }
    });
    this.trackSpotifySearchQueryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.searchSpotifyLocalWithEditedQuery();
      }
    });
    this.trackMediaIdInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.resolveLocalAudio();
      }
    });
  }

  setQueue(queue: Track[]): void {
    this.queue = queue;
    this.render();
  }

  openAddModal(): void {
    this.trackOverlay.style.display = 'flex';
    this.trackUrlInput.value = '';
    this.trackSearchQueryInput.value = '';
    this.trackSpotifyUrlInput.value = '';
    this.trackSpotifySearchQueryInput.value = '';
    this.trackMediaIdInput.value = '';
    this.setTrackAddMode('url', false);
    this.clearSearchResults();
    this.btnResolve.disabled = false;
    this.btnSearch.disabled = false;
    this.trackUrlInput.focus();
  }

  sortQueue(sort: 'title-asc' | 'title-desc' | 'duration-asc' | 'duration-desc' | 'member-round-robin'): void {
    if (sort === 'member-round-robin') {
      const tracksByMember = new Map<string, Track[]>();
      for (const track of this.queue) {
        const memberTracks = tracksByMember.get(track.addedBy) ?? [];
        memberTracks.push(track);
        tracksByMember.set(track.addedBy, memberTracks);
      }

      const roundRobin: Track[] = [];
      let addedTrack = true;
      for (let trackIndex = 0; addedTrack; trackIndex += 1) {
        addedTrack = false;
        for (const memberTracks of tracksByMember.values()) {
          const track = memberTracks[trackIndex];
          if (track) {
            roundRobin.push(track);
            addedTrack = true;
          }
        }
      }

      this.wsClient.reorderQueue(roundRobin.map((track) => track.id));
      return;
    }

    const direction = sort.endsWith('desc') ? -1 : 1;
    const byDuration = sort.startsWith('duration');
    const sorted = [...this.queue].sort((a, b) => {
      if (byDuration) {
        return ((a.durationSeconds ?? Number.MAX_SAFE_INTEGER) - (b.durationSeconds ?? Number.MAX_SAFE_INTEGER)) * direction;
      }
      return a.title.localeCompare(b.title, 'ja') * direction;
    });
    this.wsClient.reorderQueue(sorted.map((track) => track.id));
  }

  private render(): void {
    this.countEl.textContent = String(this.queue.length);
    this.listEl.innerHTML = '';

    if (this.queue.length === 0) {
      this.listEl.innerHTML = '<div class="empty-state">キューに曲がありません。曲を追加しましょう！</div>';
      return;
    }

    this.queue.forEach((track, index) => {
      const el = this.createTrackElement(track, index);
      this.listEl.appendChild(el);
    });
  }

  private createTrackElement(track: Track, index: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'track-item';
    el.dataset.trackId = track.id;
    el.dataset.index = String(index);
    el.draggable = true;

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

    const meta = document.createElement('div');
    meta.className = 'track-meta';
    meta.textContent = track.artist;

    info.append(title, meta);

    const addedBy = document.createElement('span');
    addedBy.className = 'track-added-by';
    addedBy.textContent = track.addedBy;
    addedBy.title = `追加者: ${track.addedBy}`;

    const favoriteBtn = document.createElement('button');
    const isFavorite = this.favoritesStore.has(track.id);
    favoriteBtn.className = `track-favorite${isFavorite ? ' is-favorite' : ''}`;
    favoriteBtn.textContent = isFavorite ? '★' : '☆';
    favoriteBtn.title = isFavorite ? 'お気に入りから削除' : 'お気に入りに追加';
    favoriteBtn.setAttribute('aria-label', favoriteBtn.title);
    favoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const added = this.favoritesStore.toggle(track);
      this.showToast(added ? 'お気に入りに追加しました' : 'お気に入りから削除しました', 'success');
      this.render();
      this.onFavoritesChanged();
    });

    const actions = document.createElement('div');
    actions.className = 'track-actions';

    const moreBtn = document.createElement('button');
    moreBtn.className = 'track-more';
    moreBtn.textContent = '⋯';
    moreBtn.title = '曲のメニュー';
    moreBtn.setAttribute('aria-label', '曲のメニュー');
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = moreBtn.getBoundingClientRect();
      this.showContextMenuAt(rect.left, rect.bottom + 4, track, index);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'track-delete';
    delBtn.textContent = '×';
    delBtn.title = '削除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.wsClient.removeTrack(track.id);
    });
    actions.append(moreBtn, delBtn);

    el.append(thumb, info, addedBy, favoriteBtn, actions);

    // Drag & Drop
    el.addEventListener('dragstart', (e) => {
      this.dragSrcIndex = index;
      el.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', String(index));
      e.dataTransfer!.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      this.dragSrcIndex = null;
      this.listEl.querySelectorAll('.track-item').forEach((item) => item.classList.remove('drag-over'));
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const srcIndex = this.dragSrcIndex;
      if (srcIndex === null || srcIndex === index) return;

      const newOrder = this.queue.map((t) => t.id);
      const [moved] = newOrder.splice(srcIndex, 1);
      newOrder.splice(index, 0, moved);
      this.wsClient.reorderQueue(newOrder);
    });

    // Context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenuAt(e.clientX, e.clientY, track, index);
    });

    // Double-click to open link
    el.addEventListener('dblclick', () => {
      if (track.url) {
        window.electronAPI.openExternal(track.url);
      }
    });

    return el;
  }

  private showContextMenuAt(x: number, y: number, track: Track, index: number): void {
    const menu = document.getElementById('context-menu')!;
    menu.innerHTML = '';

    type MenuItem =
      | { separator: true }
      | { label: string; action: () => void; disabled?: boolean; danger?: boolean };

    const items: MenuItem[] = [
      { label: '⬆️ 上へ', action: () => this.moveTrack(index, index - 1), disabled: index === 0 },
      { label: '⬇️ 下へ', action: () => this.moveTrack(index, index + 1), disabled: index === this.queue.length - 1 },
      { separator: true },
      { label: '🔗 リンクを開く', action: () => window.electronAPI.openExternal(track.url) },
      { separator: true },
      { label: '🗑️ 削除', action: () => this.wsClient.removeTrack(track.id), danger: true },
    ];

    items.forEach((item) => {
      if ('separator' in item) {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        menu.appendChild(sep);
        return;
      }
      const div = document.createElement('div');
      div.className = 'context-menu-item';
      if (item.danger) div.classList.add('danger');
      div.textContent = item.label;
      if (item.disabled) {
        div.style.opacity = '0.4';
        div.style.pointerEvents = 'none';
      } else {
        div.addEventListener('click', () => {
          menu.style.display = 'none';
          item.action();
        });
      }
      menu.appendChild(div);
    });

    menu.style.display = 'block';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Prevent going off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  }

  private moveTrack(fromIndex: number, toIndex: number): void {
    if (toIndex < 0 || toIndex >= this.queue.length) return;
    const newOrder = this.queue.map((t) => t.id);
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    this.wsClient.reorderQueue(newOrder);
  }

  // ── Add Track Modal ──
  private closeAddModal(): void {
    this.trackOverlay.style.display = 'none';
    this.activeResolutionRequestId = null;
  }

  private setTrackAddMode(mode: TrackAddMode, focusInput = true): void {
    this.activeAddMode = mode;
    this.modeButtons.forEach((button) => {
      const isActive = button.dataset.trackAddMode === mode;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });
    this.urlModePanel.hidden = mode !== 'url';
    this.spotifyModePanel.hidden = mode !== 'spotify';
    this.localModePanel.hidden = mode !== 'local';
    this.btnResolve.textContent = this.getResolveButtonText(mode);
    this.btnSearch.disabled = mode !== 'url';
    this.btnSpotifySearch.disabled = mode !== 'spotify';
    this.clearSearchResults();

    if (focusInput) {
      this.getPrimaryInputForMode(mode).focus();
    }
  }

  private toTrackAddMode(mode: string | undefined): TrackAddMode {
    if (mode === 'spotify' || mode === 'local') return mode;
    return 'url';
  }

  private getResolveButtonText(mode: TrackAddMode = this.activeAddMode): string {
    if (mode === 'spotify') return 'Spotifyを解析';
    if (mode === 'local') return 'IDを解決';
    return 'URLを解析';
  }

  private getPrimaryInputForMode(mode: TrackAddMode): HTMLInputElement {
    if (mode === 'spotify') return this.trackSpotifyUrlInput;
    if (mode === 'local') return this.trackMediaIdInput;
    return this.trackUrlInput;
  }

  private async resolveUrl(): Promise<void> {
    await this.resolveTrack(false);
  }

  private async searchWithEditedQuery(): Promise<void> {
    if (this.activeAddMode === 'local') return;
    if (this.activeAddMode === 'spotify') {
      await this.searchSpotifyLocalWithEditedQuery();
      return;
    }
    if (!this.trackSearchQueryInput.value.trim()) {
      this.showToast('検索コマンドを入力してください', 'error');
      this.trackSearchQueryInput.focus();
      return;
    }
    await this.resolveTrack(true);
  }

  private async resolveTrack(useEditedQuery: boolean): Promise<void> {
    const url = this.trackUrlInput.value.trim();
    if (!url) {
      this.showToast('URLを入力してください', 'error');
      this.trackUrlInput.focus();
      return;
    }

    const requestSequence = ++this.resolutionSequence;
    this.clearSearchResults(false);
    this.btnResolve.textContent = '解析中...';
    this.btnResolve.disabled = true;
    this.btnSearch.disabled = true;

    try {
      const result = await window.electronAPI.resolveTrack(
        url,
        useEditedQuery ? { searchQuery: this.trackSearchQueryInput.value.trim() } : undefined,
      );
      if (requestSequence !== this.resolutionSequence) return;
      this.activeResolutionRequestId = result.requestId;
      if (!useEditedQuery) this.trackSearchQueryInput.value = result.searchQuery;
      this.renderCandidates('youtube', result.youtube);
      const directYouTubeTrack = result.youtube.length === 1 ? result.youtube[0].track : null;
      const isDirectYouTubeVideo = directYouTubeTrack?.service === MusicServiceType.YouTube
        && Boolean(directYouTubeTrack.resolvedVideoId);
      if (isDirectYouTubeVideo) {
        document.getElementById('track-candidate-youtube-music')!.replaceChildren();
      } else if (result.youtubeMusic.length > 0) {
        this.renderCandidates('youtubeMusic', result.youtubeMusic);
      } else {
        this.renderYouTubeMusicLoading();
      }
      this.trackCandidates.style.display = 'grid';
      const deferredYouTubeMusic = this.pendingYouTubeMusicResults.get(result.requestId);
      if (deferredYouTubeMusic) {
        this.pendingYouTubeMusicResults.delete(result.requestId);
        this.renderCandidates('youtubeMusic', deferredYouTubeMusic.youtubeMusic);
      }
    } catch (error) {
      if (requestSequence === this.resolutionSequence) {
        console.error('[QueuePanel] Track resolution failed:', error);
        this.showToast('URLを解析できませんでした。しばらくしてから再試行してください。', 'error');
      }
    } finally {
      if (requestSequence === this.resolutionSequence) {
        this.btnResolve.textContent = this.getResolveButtonText();
        this.btnResolve.disabled = false;
        this.btnSearch.disabled = this.activeAddMode !== 'url';
        this.btnSpotifySearch.disabled = this.activeAddMode !== 'spotify';
      }
    }
  }

  private async resolveSpotifyUrlToLocalSearch(): Promise<void> {
    const spotifyUrl = this.trackSpotifyUrlInput.value.trim();
    if (!spotifyUrl) {
      this.showToast('Spotify URLを入力してください', 'error');
      this.trackSpotifyUrlInput.focus();
      return;
    }

    const requestSequence = ++this.resolutionSequence;
    this.clearSearchResults(false);
    this.btnResolve.textContent = '解析中...';
    this.btnResolve.disabled = true;
    this.btnSpotifySearch.disabled = true;

    try {
      const result = await window.electronAPI.resolveTrack(spotifyUrl);
      if (requestSequence !== this.resolutionSequence) return;

      this.trackSpotifySearchQueryInput.value = result.searchQuery;
      await this.searchSpotifyLocalTracks(result.searchQuery, requestSequence);
    } catch (error) {
      if (requestSequence === this.resolutionSequence) {
        console.error('[QueuePanel] Spotify URL resolution failed:', error);
        this.showToast('Spotify URLを解析できませんでした。', 'error');
      }
    } finally {
      if (requestSequence === this.resolutionSequence) {
        this.btnResolve.textContent = this.getResolveButtonText();
        this.btnResolve.disabled = false;
        this.btnSpotifySearch.disabled = false;
      }
    }
  }

  private async searchSpotifyLocalWithEditedQuery(): Promise<void> {
    const query = this.trackSpotifySearchQueryInput.value.trim();
    if (!query) {
      this.showToast('検索コマンドを入力してください', 'error');
      this.trackSpotifySearchQueryInput.focus();
      return;
    }

    const requestSequence = ++this.resolutionSequence;
    this.clearSearchResults(false);
    this.btnSpotifySearch.disabled = true;
    await this.searchSpotifyLocalTracks(query, requestSequence);
    if (requestSequence === this.resolutionSequence) {
      this.btnSpotifySearch.disabled = false;
    }
  }

  private async searchSpotifyLocalTracks(query: string, requestSequence: number): Promise<void> {
    this.spotifyTrackCandidates.style.display = 'grid';
    this.spotifyLocalResults.innerHTML = '<p class="track-candidate-error">ローカルトラックを検索中...</p>';

    try {
      const results = await window.electronAPI.searchLocalAudioTracks(query);
      if (requestSequence !== this.resolutionSequence) return;
      this.renderSpotifyLocalResults(results);
    } catch (error) {
      if (requestSequence === this.resolutionSequence) {
        console.error('[QueuePanel] Spotify local track search failed:', error);
        this.spotifyLocalResults.innerHTML = '<p class="track-candidate-error">ローカルトラック検索に失敗しました。</p>';
        this.showToast('ローカルトラック検索に失敗しました', 'error');
      }
    }
  }

  private async resolveLocalAudio(): Promise<void> {
    const mediaId = this.trackMediaIdInput.value.trim();
    if (!mediaId) {
      this.showToast('メディアIDを入力してください', 'error');
      this.trackMediaIdInput.focus();
      return;
    }

    const requestSequence = ++this.resolutionSequence;
    this.clearSearchResults(false);
    this.btnResolve.textContent = '解決中...';
    this.btnResolve.disabled = true;
    this.btnSearch.disabled = true;
    this.btnSpotifySearch.disabled = true;

    try {
      const metadata = await window.electronAPI.getAudioStream(mediaId);
      if (requestSequence !== this.resolutionSequence) return;

      const track: Track = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: metadata.url,
        resolvedVideoId: null,
        title: metadata.title,
        artist: metadata.artist,
        thumbnailUrl: '',
        durationSeconds: null,
        addedBy: '',
        service: MusicServiceType.LocalAudio,
      };

      this.resolvedTrack = track;
      this.renderLocalAudioPreview(track);
      this.btnAddPlaylist.disabled = false;
      this.btnAddQueue.disabled = false;
    } catch (error) {
      if (requestSequence === this.resolutionSequence) {
        console.error('[QueuePanel] Local audio resolution failed:', error);
        this.showToast('メディアIDを解決できませんでした。', 'error');
      }
    } finally {
      if (requestSequence === this.resolutionSequence) {
        this.btnResolve.textContent = this.getResolveButtonText();
        this.btnResolve.disabled = false;
        this.btnSearch.disabled = this.activeAddMode !== 'url';
        this.btnSpotifySearch.disabled = this.activeAddMode !== 'spotify';
      }
    }
  }

  private clearSearchResults(invalidatePending = true): void {
    if (invalidatePending) this.resolutionSequence++;
    this.activeResolutionRequestId = null;
    this.resolvedTrack = null;
    this.btnAddPlaylist.disabled = true;
    this.btnAddQueue.disabled = true;
    this.trackCandidates.style.display = 'none';
    this.spotifyTrackCandidates.style.display = 'none';
    document.getElementById('track-candidate-youtube')!.replaceChildren();
    document.getElementById('track-candidate-youtube-music')!.replaceChildren();
    this.spotifyLocalResults.replaceChildren();
    this.localAudioPreview.style.display = 'none';
    this.localAudioPreview.replaceChildren();
  }

  private renderYouTubeMusicLoading(): void {
    const list = document.getElementById('track-candidate-youtube-music')!;
    const loading = document.createElement('p');
    loading.className = 'track-candidate-error';
    loading.textContent = 'YouTube Music の候補を検索中...';
    list.replaceChildren(loading);
  }

  private renderCandidates(
    kind: 'youtube' | 'youtubeMusic',
    candidates: TrackSearchCandidate[],
  ): void {
    const suffix = kind === 'youtubeMusic' ? 'youtube-music' : kind;
    const list = document.getElementById(`track-candidate-${suffix}`)!;
    list.replaceChildren();
    const fragment = document.createDocumentFragment();

    candidates.forEach((candidate) => {
      if (!candidate.track) {
        const error = document.createElement('p');
        error.className = 'track-candidate-error';
        error.textContent = candidate.error || '候補が見つかりませんでした。';
        fragment.appendChild(error);
        return;
      }

      const card = document.createElement('button');
      card.className = 'track-candidate';
      card.type = 'button';

      const thumb = document.createElement('img');
      thumb.className = 'track-candidate-thumb';
      thumb.src = candidate.track.thumbnailUrl;
      thumb.alt = '';

      const copy = document.createElement('span');
      copy.className = 'track-candidate-copy';
      const title = document.createElement('span');
      title.className = 'track-candidate-title';
      title.textContent = candidate.track.title;
      const meta = document.createElement('span');
      meta.className = 'track-candidate-meta';
      meta.textContent = `${candidate.track.artist}${this.formatCandidateDuration(candidate.track.durationSeconds)}`;
      copy.append(title, meta);
      card.append(thumb, copy);
      card.addEventListener('click', () => this.selectCandidate(candidate.track!, card));
      fragment.appendChild(card);
    });
    list.appendChild(fragment);
  }

  private renderSpotifyLocalResults(results: LocalAudioSearchResult[]): void {
    this.spotifyLocalResults.replaceChildren();

    if (results.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'track-candidate-error';
      empty.textContent = '一致するローカルトラックが見つかりませんでした。';
      this.spotifyLocalResults.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach((result) => {
      const card = document.createElement('button');
      card.className = 'track-candidate';
      card.type = 'button';

      const thumb = document.createElement('img');
      thumb.className = 'track-candidate-thumb';
      thumb.src = result.thumbnailUrl || '';
      thumb.alt = '';
      if (!result.thumbnailUrl) {
        thumb.style.background = '#333';
      }

      const copy = document.createElement('span');
      copy.className = 'track-candidate-copy';
      const title = document.createElement('span');
      title.className = 'track-candidate-title';
      title.textContent = result.title;
      const meta = document.createElement('span');
      meta.className = 'track-candidate-meta';
      meta.textContent = [
        result.artist || 'Unknown Artist',
        result.durationSeconds ? this.formatCandidateDuration(result.durationSeconds).replace(/^ ・ /, '') : null,
      ].filter(Boolean).join(' ・ ');
      copy.append(title, meta);
      card.append(thumb, copy);
      card.addEventListener('click', () => this.selectLocalAudioSearchResult(result, card));
      fragment.appendChild(card);
    });

    this.spotifyLocalResults.appendChild(fragment);
  }

  private selectCandidate(candidate: Omit<Track, 'addedBy'>, card: HTMLButtonElement): void {
    this.resolvedTrack = {
      ...candidate,
      id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      addedBy: '',
    };
    this.btnAddPlaylist.disabled = false;
    this.btnAddQueue.disabled = false;
    this.trackCandidates.querySelectorAll('.track-candidate.selected').forEach((element) => {
      element.classList.remove('selected');
    });
    card.classList.add('selected');
  }

  private selectLocalAudioSearchResult(result: LocalAudioSearchResult, card: HTMLButtonElement): void {
    this.resolvedTrack = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: `musicshare://local-audio/${encodeURIComponent(result.id)}`,
      resolvedVideoId: null,
      title: result.title,
      artist: result.artist || 'Unknown Artist',
      thumbnailUrl: result.thumbnailUrl || '',
      durationSeconds: result.durationSeconds ?? null,
      addedBy: '',
      service: MusicServiceType.LocalAudio,
    };
    this.btnAddPlaylist.disabled = false;
    this.btnAddQueue.disabled = false;
    this.spotifyLocalResults.querySelectorAll('.track-candidate.selected').forEach((element) => {
      element.classList.remove('selected');
    });
    card.classList.add('selected');
  }

  private renderLocalAudioPreview(track: Track): void {
    const card = document.createElement('button');
    card.className = 'track-candidate selected';
    card.type = 'button';

    const thumb = document.createElement('span');
    thumb.className = 'track-candidate-thumb';
    thumb.textContent = '♪';
    thumb.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('span');
    copy.className = 'track-candidate-copy';
    const title = document.createElement('span');
    title.className = 'track-candidate-title';
    title.textContent = track.title;
    const meta = document.createElement('span');
    meta.className = 'track-candidate-meta';
    meta.textContent = `${track.artist || 'Unknown Artist'} ・ ${track.url}`;
    copy.append(title, meta);
    card.append(thumb, copy);
    card.addEventListener('click', () => {
      this.resolvedTrack = track;
      card.classList.add('selected');
      this.btnAddPlaylist.disabled = false;
      this.btnAddQueue.disabled = false;
    });

    this.localAudioPreview.replaceChildren(card);
    this.localAudioPreview.style.display = 'flex';
  }

  private formatCandidateDuration(durationSeconds: number | null): string {
    if (durationSeconds === null || !Number.isFinite(durationSeconds)) return '';
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.floor(durationSeconds % 60).toString().padStart(2, '0');
    return ` ・ ${minutes}:${seconds}`;
  }

  private addResolvedTrack(): void {
    if (!this.resolvedTrack) return;
    this.wsClient.addTrack(this.resolvedTrack);
    this.closeAddModal();
  }
}

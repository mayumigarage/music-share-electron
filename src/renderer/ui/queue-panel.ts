/**
 * MusicShare — Queue Panel (Center)
 * Phase 6: Queue rendering, drag-and-drop reorder, custom context menu, double-click open link.
 */

import type { WebSocketClient } from '../sync/websocket-client.js';
import type { Track } from '../../shared/models.js';
import '../../shared/preload-api.js';

export class QueuePanel {
  private queue: Track[] = [];
  private dragSrcIndex: number | null = null;

  private listEl = document.getElementById('queue-list') as HTMLElement;
  private countEl = document.getElementById('queue-count') as HTMLElement;
  private addBtn = document.getElementById('btn-add-track') as HTMLButtonElement;

  // Track add modal refs
  private trackOverlay = document.getElementById('modal-overlay-track') as HTMLElement;
  private trackUrlInput = document.getElementById('input-track-url') as HTMLInputElement;
  private trackPreview = document.getElementById('track-preview') as HTMLElement;
  private previewThumb = document.getElementById('preview-thumb') as HTMLImageElement;
  private previewTitle = document.getElementById('preview-title') as HTMLElement;
  private previewArtist = document.getElementById('preview-artist') as HTMLElement;
  private btnResolve = document.getElementById('btn-track-resolve') as HTMLButtonElement;
  private btnAdd = document.getElementById('btn-track-add') as HTMLButtonElement;

  private resolvedTrack: Track | null = null;

  constructor(
    private wsClient: WebSocketClient,
    private showToast: (msg: string, type?: 'info' | 'success' | 'error') => void,
  ) {}

  init(): void {
    this.addBtn.addEventListener('click', () => this.openAddModal());
    document.getElementById('btn-track-cancel')?.addEventListener('click', () => this.closeAddModal());
    this.btnResolve.addEventListener('click', () => this.resolveUrl());
    this.btnAdd.addEventListener('click', () => this.addResolvedTrack());
  }

  setQueue(queue: Track[]): void {
    this.queue = queue;
    this.render();
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
    meta.textContent = `${track.artist} • ${this.formatDuration(track.durationSeconds)}`;

    info.append(title, meta);

    const service = document.createElement('span');
    service.className = 'track-service';
    service.textContent = track.service;

    const addedBy = document.createElement('span');
    addedBy.className = 'track-added-by';
    addedBy.textContent = track.addedBy;
    addedBy.title = `Added by: ${track.addedBy}`;

    const actions = document.createElement('div');
    actions.className = 'track-actions';

    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑️';
    delBtn.title = '削除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.wsClient.removeTrack(track.id);
    });
    actions.appendChild(delBtn);

    el.append(thumb, info, service, addedBy, actions);

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
      this.showContextMenu(e, track, index);
    });

    // Double-click to open link
    el.addEventListener('dblclick', () => {
      if (track.url) {
        window.electronAPI.openExternal(track.url);
      }
    });

    return el;
  }

  private showContextMenu(e: MouseEvent, track: Track, index: number): void {
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
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

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

  private formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ── Add Track Modal ──
  private openAddModal(): void {
    this.trackOverlay.style.display = 'flex';
    this.trackUrlInput.value = '';
    this.trackPreview.style.display = 'none';
    this.btnResolve.style.display = 'inline-flex';
    this.btnAdd.style.display = 'none';
    this.resolvedTrack = null;
    this.trackUrlInput.focus();
  }

  private closeAddModal(): void {
    this.trackOverlay.style.display = 'none';
  }

  private async resolveUrl(): Promise<void> {
    const url = this.trackUrlInput.value.trim();
    if (!url) return;

    this.btnResolve.textContent = '解析中...';
    this.btnResolve.disabled = true;

    try {
      const result = await window.electronAPI.resolveTrack(url);
      if ('error' in result || ('isFallback' in result && result.isFallback)) {
        this.showToast('URLの解析に失敗しました', 'error');
        return;
      }

      this.resolvedTrack = {
        id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: result.url,
        title: result.title,
        artist: result.artist,
        thumbnailUrl: result.thumbnailUrl,
        durationSeconds: result.durationSeconds,
        addedBy: '', // filled by server
        service: result.service,
      };

      this.previewThumb.src = result.thumbnailUrl || '';
      this.previewTitle.textContent = result.title;
      this.previewArtist.textContent = result.artist;
      this.trackPreview.style.display = 'flex';

      this.btnResolve.style.display = 'none';
      this.btnAdd.style.display = 'inline-flex';
    } finally {
      this.btnResolve.textContent = 'URLを解析';
      this.btnResolve.disabled = false;
    }
  }

  private addResolvedTrack(): void {
    if (!this.resolvedTrack) return;
    this.wsClient.addTrack(this.resolvedTrack);
    this.closeAddModal();
  }
}

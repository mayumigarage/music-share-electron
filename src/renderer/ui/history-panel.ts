/**
 * MusicShare — History Panel (Center Tab)
 * Phase 6: Displays up to 100 played tracks.
 */

import type { TrackHistory } from '../../shared/models.js';

export class HistoryPanel {
  private history: TrackHistory[] = [];
  private listEl = document.getElementById('history-list') as HTMLElement;

  init(): void {
    // Tab switching is handled by AppUI binding, but we need local listeners too
    const tabs = document.querySelectorAll<HTMLElement>('#center-tabs .tab');
    const queuePanel = document.getElementById('queue-panel') as HTMLElement;
    const historyPanel = document.getElementById('history-panel') as HTMLElement;

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const name = tab.dataset.tab;
        queuePanel.style.display = name === 'queue' ? 'block' : 'none';
        historyPanel.style.display = name === 'history' ? 'block' : 'none';
      });
    });
  }

  setHistory(history: TrackHistory[]): void {
    this.history = history;
    this.render();
  }

  private render(): void {
    this.listEl.innerHTML = '';

    if (this.history.length === 0) {
      this.listEl.innerHTML = '<div class="empty-state">再生履歴がありません</div>';
      return;
    }

    // Show most recent first
    [...this.history].reverse().forEach((entry) => {
      const el = this.createEntryElement(entry);
      this.listEl.appendChild(el);
    });
  }

  private createEntryElement(entry: TrackHistory): HTMLElement {
    const track = entry.track;
    const el = document.createElement('div');
    el.className = 'track-item';

    const thumb = document.createElement('img');
    thumb.className = 'track-thumb';
    thumb.src = track.thumbnailUrl || '';
    thumb.alt = '';
    if (!track.thumbnailUrl) thumb.style.background = '#333';

    const info = document.createElement('div');
    info.className = 'track-info';

    const title = document.createElement('div');
    title.className = 'track-title';
    title.textContent = track.title;

    const meta = document.createElement('div');
    meta.className = 'track-meta';
    meta.textContent = `${track.artist} • ${this.formatDate(entry.playedAt)}`;

    info.append(title, meta);

    const service = document.createElement('span');
    service.className = 'track-service';
    service.textContent = track.service;

    el.append(thumb, info, service);

    el.addEventListener('dblclick', () => {
      if (track.url) window.electronAPI.openExternal(track.url);
    });

    return el;
  }

  private formatDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

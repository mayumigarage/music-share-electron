/**
 * MusicShare — Audio-only search panel
 *
 * UI glue for the independent HTML5 Audio route. This deliberately does not
 * call PlayerProxy or the WebContentsView players.
 */

import {
  pauseAudioOnlyMode,
  playAudioOnlyMode,
  resumeAudioOnlyMode,
  searchAudioOnlyCatalog,
  setAudioOnlyVolume,
  stopAudioOnlyMode,
} from '../sync/audio-only-player.js';
import type { AudioOnlySearchResult } from '../sync/audio-only-player.js';

export class AudioSearchPanel {
  private form = document.getElementById('audio-search-form') as HTMLFormElement;
  private input = document.getElementById('search-query') as HTMLInputElement;
  private resultsEl = document.getElementById('audio-search-results') as HTMLElement;
  private statusEl = document.getElementById('audio-search-status') as HTMLElement;
  private btnPause = document.getElementById('btn-audio-only-pause') as HTMLButtonElement;
  private btnResume = document.getElementById('btn-audio-only-resume') as HTMLButtonElement;
  private btnStop = document.getElementById('btn-audio-only-stop') as HTMLButtonElement;
  private volume = document.getElementById('audio-only-volume') as HTMLInputElement;

  constructor(
    private showToast: (message: string, type?: 'info' | 'success' | 'error') => void,
  ) {}

  init(): void {
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.search();
    });

    this.btnPause.addEventListener('click', () => {
      pauseAudioOnlyMode();
      this.setStatus('一時停止中');
    });

    this.btnResume.addEventListener('click', async () => {
      try {
        await resumeAudioOnlyMode();
        this.setStatus('再生中');
      } catch (error) {
        console.error('[AudioSearchPanel] Failed to resume audio-only playback:', error);
        this.showToast('Audio-only の再開に失敗しました', 'error');
      }
    });

    this.btnStop.addEventListener('click', () => {
      stopAudioOnlyMode();
      this.setStatus('停止中');
    });

    this.volume.addEventListener('input', () => {
      setAudioOnlyVolume(Number(this.volume.value));
    });
  }

  private async search(): Promise<void> {
    const query = this.input.value.trim();
    this.setStatus('検索中...');
    this.resultsEl.innerHTML = '<div class="empty-state">検索中...</div>';

    try {
      const results = await searchAudioOnlyCatalog(query);
      this.renderResults(results);
      this.setStatus(results.length > 0 ? `${results.length}件見つかりました` : '検索結果なし');
    } catch (error) {
      console.error('[AudioSearchPanel] Audio-only search failed:', error);
      this.resultsEl.innerHTML = '<div class="empty-state">Audio-only 検索に失敗しました</div>';
      this.setStatus('検索エラー');
      this.showToast('Audio-only 検索に失敗しました', 'error');
    }
  }

  private renderResults(results: AudioOnlySearchResult[]): void {
    this.resultsEl.innerHTML = '';

    if (results.length === 0) {
      this.resultsEl.innerHTML = '<div class="empty-state">許可済み音源が見つかりませんでした</div>';
      return;
    }

    results.forEach((result) => {
      const item = document.createElement('div');
      item.className = 'track-item audio-search-item';

      const thumb = document.createElement('img');
      thumb.className = 'track-thumb';
      thumb.src = result.thumbnailUrl || '';
      thumb.alt = '';
      thumb.style.display = result.thumbnailUrl ? 'block' : 'none';

      const info = document.createElement('div');
      info.className = 'track-info';

      const title = document.createElement('div');
      title.className = 'track-title';
      title.textContent = result.title;

      const meta = document.createElement('div');
      meta.className = 'track-meta';
      meta.textContent = [result.artist, result.durationSeconds ? this.formatDuration(result.durationSeconds) : null]
        .filter(Boolean)
        .join(' ・ ') || 'Audio-only';

      info.append(title, meta);

      const badge = document.createElement('span');
      badge.className = 'track-service';
      badge.textContent = 'Audio';

      const actions = document.createElement('div');
      actions.className = 'track-actions';

      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'audio-search-play';
      playButton.textContent = '▶';
      playButton.title = 'Audio-onlyで再生';
      playButton.setAttribute('aria-label', `${result.title} を Audio-only で再生`);
      playButton.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.play(result.id);
      });

      actions.append(playButton);
      item.append(thumb, info, badge, actions);
      item.addEventListener('dblclick', () => {
        void this.play(result.id);
      });

      this.resultsEl.appendChild(item);
    });
  }

  private async play(sourceId: string): Promise<void> {
    this.setStatus('読み込み中...');

    try {
      const metadata = await playAudioOnlyMode(sourceId);
      this.setStatus(`再生中: ${metadata.title}`);
      this.showToast(`Audio-onlyで「${metadata.title}」を再生中`, 'success');
    } catch (error) {
      console.error('[AudioSearchPanel] Failed to play audio-only source:', error);
      this.setStatus('再生エラー');
      this.showToast('Audio-only 再生に失敗しました', 'error');
    }
  }

  private setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.max(0, Math.floor(seconds % 60));
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }
}

/**
 * MusicShare — Settings Modal
 * User preferences UI with localStorage persistence.
 */

export class SettingsModal {
  private overlay = document.getElementById('modal-overlay-settings') as HTMLElement;
  private checkbox = document.getElementById('setting-spotify-convert') as HTMLInputElement;
  private closeBtn = document.getElementById('btn-settings-close') as HTMLButtonElement;

  /** localStorage key for the Spotify → YouTube auto-convert toggle */
  static readonly STORAGE_KEY_SPOTIFY_CONVERT = 'spotifyAutoConvert';

  init(): void {
    // Load saved preference (default: true)
    const savedValue = localStorage.getItem(SettingsModal.STORAGE_KEY_SPOTIFY_CONVERT);
    this.checkbox.checked = savedValue !== 'false';

    // Save on change
    this.checkbox.addEventListener('change', () => {
      localStorage.setItem(
        SettingsModal.STORAGE_KEY_SPOTIFY_CONVERT,
        this.checkbox.checked ? 'true' : 'false',
      );
    });

    // Close button
    this.closeBtn.addEventListener('click', () => this.close());

    // Close on overlay click (outside modal)
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // Close on Escape key
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  open(): void {
    // Refresh current value when opening
    const savedValue = localStorage.getItem(SettingsModal.STORAGE_KEY_SPOTIFY_CONVERT);
    this.checkbox.checked = savedValue !== 'false';

    this.overlay.style.display = 'flex';
    this.closeBtn.focus();
  }

  close(): void {
    this.overlay.style.display = 'none';
  }

  /**
   * Get the current auto-convert setting.
   * Default: true (enabled)
   */
  static isSpotifyAutoConvertEnabled(): boolean {
    return localStorage.getItem(SettingsModal.STORAGE_KEY_SPOTIFY_CONVERT) !== 'false';
  }
}

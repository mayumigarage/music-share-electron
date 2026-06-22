/**
 * MusicShare — Settings Modal
 * Spotify auth management.
 */

export class SettingsModal {
  private overlay = document.getElementById('modal-overlay-settings') as HTMLElement;
  private closeBtn = document.getElementById('btn-settings-close') as HTMLButtonElement;

  private spotifyStatusLabel = document.getElementById('settings-spotify-status') as HTMLElement;
  private loginBtn = document.getElementById('btn-settings-spotify-login') as HTMLButtonElement;
  private logoutBtn = document.getElementById('btn-settings-spotify-logout') as HTMLButtonElement;
  private unsubscribeTokenListener: (() => void) | null = null;

  init(): void {
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

    // Bind Spotify auth buttons
    this.loginBtn.addEventListener('click', () => this.handleSpotifyLogin());
    this.logoutBtn.addEventListener('click', () => this.handleSpotifyLogout());

    // Listen for Spotify token updates from main process
    this.unsubscribeTokenListener = window.electronAPI.onSpotifyToken((token) => {
      this.updateSpotifyAuthUI(!!token);
    });

    // Initial auth state check
    this.refreshSpotifyAuthStatus();
  }

  async open(): Promise<void> {
    // Refresh Spotify auth status when opening settings
    await this.refreshSpotifyAuthStatus();

    this.overlay.style.display = 'flex';
    this.closeBtn.focus();
  }

  close(): void {
    this.overlay.style.display = 'none';
  }

  /**
   * Refresh the current Spotify authentication status.
   */
  private async refreshSpotifyAuthStatus(): Promise<void> {
    try {
      const token = await window.electronAPI.getSpotifyToken();
      this.updateSpotifyAuthUI(!!token);
    } catch {
      this.updateSpotifyAuthUI(false);
    }
  }

  /**
   * Update the Spotify auth UI based on authentication state.
   */
  private updateSpotifyAuthUI(isAuthenticated: boolean): void {
    if (isAuthenticated) {
      this.spotifyStatusLabel.textContent = 'ログイン済み';
      this.spotifyStatusLabel.style.color = 'var(--accent)';
      this.loginBtn.style.display = 'none';
      this.logoutBtn.style.display = 'inline-flex';
    } else {
      this.spotifyStatusLabel.textContent = '未ログイン';
      this.spotifyStatusLabel.style.color = 'var(--text-secondary)';
      this.loginBtn.style.display = 'inline-flex';
      this.logoutBtn.style.display = 'none';
    }
  }

  /**
   * Handle Spotify login button click.
   */
  private async handleSpotifyLogin(): Promise<void> {
    this.spotifyStatusLabel.textContent = '認証画面を開きました...';
    this.spotifyStatusLabel.style.color = 'var(--text-secondary)';
    this.loginBtn.disabled = true;

    try {
      const result = await window.electronAPI.startSpotifyAuth();
      if (!result.success) {
        this.spotifyStatusLabel.textContent = '認証に失敗しました';
        this.spotifyStatusLabel.style.color = 'var(--danger)';
      } else {
        this.spotifyStatusLabel.textContent = '認可を待っています...';
        this.spotifyStatusLabel.style.color = 'var(--text-secondary)';
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.spotifyStatusLabel.textContent = `エラー: ${msg}`;
      this.spotifyStatusLabel.style.color = 'var(--danger)';
    } finally {
      this.loginBtn.disabled = false;
    }
  }

  /**
   * Handle Spotify logout button click.
   */
  private async handleSpotifyLogout(): Promise<void> {
    try {
      await window.electronAPI.clearSpotifyAuth();
      // UI will be updated by the onSpotifyToken listener
    } catch (e) {
      console.error('Failed to logout:', e);
    }
  }

  /**
   * Clean up resources when the modal is destroyed.
   */
  destroy(): void {
    if (this.unsubscribeTokenListener) {
      this.unsubscribeTokenListener();
      this.unsubscribeTokenListener = null;
    }
  }
}

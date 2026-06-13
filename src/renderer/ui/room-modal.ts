/**
 * MusicShare — Room Modal
 * Phase 6: Create or join a room with mode selection.
 */

import type { WebSocketClient } from '../sync/websocket-client.js';
import type { RoomMode } from '../../shared/models.js';

export class RoomModal {
  private mode: 'create' | 'join' = 'create';

  private overlay = document.getElementById('modal-overlay') as HTMLElement;
  private createForm = document.getElementById('create-form') as HTMLElement;
  private joinForm = document.getElementById('join-form') as HTMLElement;
  private confirmBtn = document.getElementById('btn-modal-confirm') as HTMLButtonElement;

  constructor(private wsClient: WebSocketClient) {}

  init(): void {
    const modeOptions = document.querySelectorAll<HTMLElement>('.mode-option');
    modeOptions.forEach((opt) => {
      opt.addEventListener('click', () => {
        modeOptions.forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');
        this.mode = opt.dataset.mode as 'create' | 'join';
        this.updateFormVisibility();
      });
    });

    document.getElementById('btn-modal-cancel')?.addEventListener('click', () => this.close());
    this.confirmBtn.addEventListener('click', () => this.onConfirm());

    // Allow Enter key to submit
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onConfirm();
    });
  }

  open(): void {
    this.overlay.classList.add('active');
    const firstInput = this.overlay.querySelector('input') as HTMLInputElement | null;
    firstInput?.focus();
  }

  close(): void {
    this.overlay.classList.remove('active');
  }

  private updateFormVisibility(): void {
    if (this.mode === 'create') {
      this.createForm.style.display = 'block';
      this.joinForm.style.display = 'none';
      this.confirmBtn.textContent = '作成する';
    } else {
      this.createForm.style.display = 'none';
      this.joinForm.style.display = 'block';
      this.confirmBtn.textContent = '参加する';
    }
  }

  private onConfirm(): void {
    if (this.mode === 'create') {
      const roomName = (document.getElementById('input-room-name') as HTMLInputElement).value.trim();
      const userName = (document.getElementById('input-user-name-create') as HTMLInputElement).value.trim();
      const mode = (document.getElementById('input-room-mode') as HTMLSelectElement).value as RoomMode;

      if (!roomName || !userName) {
        this.showError('ルーム名とユーザー名を入力してください');
        return;
      }

      this.wsClient.createRoom(roomName, userName, mode);
      this.close();
    } else {
      const roomId = (document.getElementById('input-room-id') as HTMLInputElement).value.trim();
      const userName = (document.getElementById('input-user-name-join') as HTMLInputElement).value.trim();

      if (!roomId || !userName) {
        this.showError('ルームIDとユーザー名を入力してください');
        return;
      }

      this.wsClient.joinRoom(roomId, userName);
      this.close();
    }
  }

  private showError(message: string): void {
    const event = new CustomEvent('musicshare:toast', {
      detail: { message, type: 'error' as const },
    });
    window.dispatchEvent(event);
  }
}

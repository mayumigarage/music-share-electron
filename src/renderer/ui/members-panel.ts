/**
 * MusicShare — Members Panel (Right Sidebar)
 * Phase 6: Online/offline member list with host badge.
 */

import type { User } from '../../shared/models.js';
import { getIconMarkup } from './icons.js';

export class MembersPanel {
  private members: User[] = [];
  private hostId = '';

  private listEl = document.getElementById('members-list') as HTMLElement;
  private countEl = document.getElementById('member-count') as HTMLElement;

  init(): void {
    // nothing to bind initially
  }

  setMembers(members: User[], hostId: string): void {
    this.members = members;
    this.hostId = hostId;
    this.render();
  }

  addMember(user: User): void {
    const existing = this.members.find((m) => m.id === user.id);
    if (!existing) {
      this.members.push(user);
    } else {
      existing.isOnline = true;
    }
    this.render();
  }

  removeMember(userId: string): void {
    const member = this.members.find((m) => m.id === userId);
    if (member) {
      member.isOnline = false;
    }
    this.render();
  }

  private render(): void {
    this.listEl.innerHTML = '';
    this.countEl.textContent = String(this.members.filter((m) => m.isOnline).length);

    const online = this.members.filter((m) => m.isOnline);
    const offline = this.members.filter((m) => !m.isOnline);

    if (online.length > 0) {
      this.listEl.appendChild(this.createGroupLabel('オンライン', 'online'));
      online.forEach((m) => this.listEl.appendChild(this.createMemberItem(m)));
    }

    if (offline.length > 0) {
      this.listEl.appendChild(this.createGroupLabel('オフライン', 'offline'));
      offline.forEach((m) => this.listEl.appendChild(this.createMemberItem(m)));
    }

    if (this.members.length === 0) {
      this.listEl.innerHTML = '<div class="empty-state" style="padding:20px 0;font-size:12px;">メンバーがいません</div>';
    }
  }

  private createGroupLabel(text: string, status: 'online' | 'offline'): HTMLElement {
    const div = document.createElement('div');
    div.className = `member-group-label ${status}`;
    div.textContent = text;
    return div;
  }

  private createMemberItem(user: User): HTMLElement {
    const el = document.createElement('div');
    el.className = 'member-item';

    const status = document.createElement('span');
    status.className = `member-status ${user.isOnline ? 'online' : 'offline'}`;

    const name = document.createElement('span');
    name.className = 'member-name';
    name.textContent = user.name;

    el.appendChild(status);
    el.appendChild(name);

    if (user.id === this.hostId) {
      const badge = document.createElement('span');
      badge.className = 'member-badge';
      badge.innerHTML = `${getIconMarkup('trophy', { size: 16 })}<span>Host</span>`;
      el.appendChild(badge);
    }

    return el;
  }
}

/**
 * MusicShare — Layout Manager
 * Phase 3.6: Recalculate WebContentsView bounds on window resize.
 *
 * Layout (3-pane):
 *   Left panel  : fixed 240px  (DOM inside main view)
 *   Center panel: flexible     (DOM inside main view)
 *   Right panel : fixed 280px  (DOM top = members list, bottom = player WebContentsView)
 *   Bottom bar  : fixed 80px   (DOM inside main view — player controls)
 *   Top bar     : fixed 64px   (DOM inside main view — workspace controls)
 *
 * The main WebContentsView covers the entire window content area.
 * The player WebContentsView sits on top of the right-panel bottom area.
 * The renderer HTML (Phase 6) must paint the right-panel bottom area with
 * the same dark background (#121212) so the player view blends seamlessly.
 */

import { BaseWindow, WebContentsView } from 'electron';

const LEFT_PANEL_WIDTH = 240;
const RIGHT_PANEL_WIDTH = 280;
const TOP_BAR_HEIGHT = 64;
const BOTTOM_CONTROL_HEIGHT = 80;
// Room controls (190px) + member list (140px) in the right sidebar.
const MEMBERS_LIST_HEIGHT = 330;

export class LayoutManager {
  private win: BaseWindow;
  private mainView: WebContentsView;
  private playerView: WebContentsView;
  private rightSidebarVisible = true;
  private resizeHandler = () => this.recalculate();

  constructor(win: BaseWindow, mainView: WebContentsView, playerView: WebContentsView) {
    this.win = win;
    this.mainView = mainView;
    this.playerView = playerView;

    this.recalculate();
    this.win.on('resize', this.resizeHandler);
  }

  recalculate(): void {
    if (this.win.isDestroyed()) return;

    const [contentWidth, contentHeight] = this.win.getContentSize();

    // Main view fills the entire content area so the renderer can paint
    // the left / center / right-top panels and bottom bar via CSS.
    this.mainView.setBounds({
      x: 0,
      y: 0,
      width: contentWidth,
      height: contentHeight,
    });

    if (!this.rightSidebarVisible) {
      // WebContentsView is not part of the renderer DOM, so give it no visible
      // bounds while the DOM sidebar is collapsed.
      this.playerView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }

    // Player view sits in the bottom-right panel region.
    // Coordinates may be refined once Phase 6 renderer HTML is finalized.
    const playerX = contentWidth - RIGHT_PANEL_WIDTH;
    const playerY = TOP_BAR_HEIGHT + MEMBERS_LIST_HEIGHT;
    const playerWidth = RIGHT_PANEL_WIDTH;
    const playerHeight = Math.max(
      100,
      contentHeight - TOP_BAR_HEIGHT - MEMBERS_LIST_HEIGHT - BOTTOM_CONTROL_HEIGHT,
    );

    this.playerView.setBounds({
      x: playerX,
      y: playerY,
      width: playerWidth,
      height: playerHeight,
    });
  }

  setSidebarVisibility(_leftVisible: boolean, rightVisible: boolean): void {
    this.rightSidebarVisible = rightVisible;
    this.recalculate();
  }

  destroy(): void {
    this.win.removeListener('resize', this.resizeHandler);
  }
}

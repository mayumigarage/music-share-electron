/**
 * MusicShare — Layout Manager
 * Phase 3.6: Recalculate the main renderer bounds on window resize.
 *
 * Layout (3-pane):
 *   Left panel  : fixed 240px  (DOM inside main view)
 *   Center panel: flexible     (DOM inside main view)
 *   Right panel : DOM (members list and YouTube player)
 *   Bottom bar  : fixed 80px   (DOM inside main view — player controls)
 *   Top bar     : fixed 64px   (DOM inside main view — workspace controls)
 *
 * The main WebContentsView covers the entire window content area. The player
 * is a DOM element in that renderer, so it can participate in CSS stacking.
 */

import { BaseWindow, WebContentsView } from 'electron';

export class LayoutManager {
  private win: BaseWindow;
  private mainView: WebContentsView;
  private resizeHandler = () => this.recalculate();

  constructor(win: BaseWindow, mainView: WebContentsView) {
    this.win = win;
    this.mainView = mainView;

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

  }

  setSidebarVisibility(_leftVisible: boolean, _rightVisible: boolean): void {}

  destroy(): void {
    this.win.removeListener('resize', this.resizeHandler);
  }
}

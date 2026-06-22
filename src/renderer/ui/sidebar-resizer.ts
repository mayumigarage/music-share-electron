const MIN_LEFT_WIDTH = 160;
const MAX_LEFT_WIDTH = 420;
const MIN_RIGHT_WIDTH = 220;
const MAX_RIGHT_WIDTH = 480;
const MIN_CENTER_WIDTH = 320;

export function initializeSidebarResizers(): void {
  const layout = document.getElementById('app-layout');
  if (!layout) return;

  const bind = (handleId: string, side: 'left' | 'right') => {
    const handle = document.getElementById(handleId);
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
      if (layout.classList.contains(`${side}-collapsed`)) return;
      event.preventDefault();
      const startX = event.clientX;
      const root = document.documentElement;
      const variable = side === 'left' ? '--panel-left-width' : '--panel-right-width';
      const startWidth = parseFloat(getComputedStyle(root).getPropertyValue(variable));
      const maxWidth = side === 'left' ? MAX_LEFT_WIDTH : MAX_RIGHT_WIDTH;
      const minWidth = side === 'left' ? MIN_LEFT_WIDTH : MIN_RIGHT_WIDTH;
      const otherWidth = parseFloat(getComputedStyle(root).getPropertyValue(side === 'left' ? '--panel-right-width' : '--panel-left-width'));

      document.body.classList.add('is-resizing');
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const requested = side === 'left' ? startWidth + delta : startWidth - delta;
        const available = window.innerWidth - otherWidth - MIN_CENTER_WIDTH - 12;
        const width = Math.max(minWidth, Math.min(maxWidth, available, requested));
        root.style.setProperty(variable, `${width}px`);
      };
      const finish = () => {
        document.body.classList.remove('is-resizing');
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', finish);
        localStorage.setItem(variable, getComputedStyle(root).getPropertyValue(variable));
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', finish, { once: true });
    });
  };

  for (const variable of ['--panel-left-width', '--panel-right-width']) {
    const saved = localStorage.getItem(variable);
    if (saved && /^\d+(\.\d+)?px$/.test(saved)) document.documentElement.style.setProperty(variable, saved);
  }
  bind('left-panel-resizer', 'left');
  bind('right-panel-resizer', 'right');
}

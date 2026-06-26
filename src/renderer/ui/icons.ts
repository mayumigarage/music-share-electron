import { createElement, type ComponentType, type SVGProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowRightOnRectangleIcon,
  ArrowUpIcon,
  BackwardIcon,
  BarsArrowDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  EllipsisHorizontalIcon,
  ForwardIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  MusicalNoteIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  QueueListIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  TrashIcon,
  TrophyIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  HeartIcon as HeartSolidIcon,
  PauseIcon as PauseSolidIcon,
  PlayIcon as PlaySolidIcon,
} from '@heroicons/react/24/solid';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type IconName =
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-right-on-rectangle'
  | 'arrow-up'
  | 'backward'
  | 'bars-arrow-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'clock'
  | 'document-duplicate'
  | 'ellipsis-horizontal'
  | 'forward'
  | 'heart'
  | 'heart-solid'
  | 'magnifying-glass'
  | 'musical-note'
  | 'pause'
  | 'pause-solid'
  | 'play'
  | 'play-solid'
  | 'plus'
  | 'queue-list'
  | 'speaker-wave'
  | 'speaker-x-mark'
  | 'trash'
  | 'trophy'
  | 'user-group'
  | 'x-mark';

const icons: Record<IconName, IconComponent> = {
  'arrow-down': ArrowDownIcon,
  'arrow-left': ArrowLeftIcon,
  'arrow-right': ArrowRightIcon,
  'arrow-right-on-rectangle': ArrowRightOnRectangleIcon,
  'arrow-up': ArrowUpIcon,
  backward: BackwardIcon,
  'bars-arrow-down': BarsArrowDownIcon,
  'chevron-left': ChevronLeftIcon,
  'chevron-right': ChevronRightIcon,
  clock: ClockIcon,
  'document-duplicate': DocumentDuplicateIcon,
  'ellipsis-horizontal': EllipsisHorizontalIcon,
  forward: ForwardIcon,
  heart: HeartIcon,
  'heart-solid': HeartSolidIcon,
  'magnifying-glass': MagnifyingGlassIcon,
  'musical-note': MusicalNoteIcon,
  pause: PauseIcon,
  'pause-solid': PauseSolidIcon,
  play: PlayIcon,
  'play-solid': PlaySolidIcon,
  plus: PlusIcon,
  'queue-list': QueueListIcon,
  'speaker-wave': SpeakerWaveIcon,
  'speaker-x-mark': SpeakerXMarkIcon,
  trash: TrashIcon,
  trophy: TrophyIcon,
  'user-group': UserGroupIcon,
  'x-mark': XMarkIcon,
};

const iconNames = new Set<IconName>(Object.keys(icons) as IconName[]);

interface IconOptions {
  className?: string;
  size?: 16 | 18 | 20 | 24;
}

export function getIconMarkup(name: IconName, options: IconOptions = {}): string {
  const Icon = icons[name];
  const className = ['hero-icon', `hero-icon-${options.size ?? 18}`, options.className]
    .filter(Boolean)
    .join(' ');

  return renderToStaticMarkup(createElement(Icon, {
    'aria-hidden': true,
    className,
    focusable: false,
  }));
}

export function setIcon(element: HTMLElement, name: IconName, options?: IconOptions): void {
  element.innerHTML = getIconMarkup(name, options);
}

export function setIconButton(
  button: HTMLButtonElement,
  name: IconName,
  label: string,
  options?: IconOptions,
): void {
  setIcon(button, name, options);
  button.title = label;
  button.setAttribute('aria-label', label);
}

export function setIconWithText(
  element: HTMLElement,
  name: IconName,
  text: string,
  options?: IconOptions,
): void {
  element.innerHTML = `${getIconMarkup(name, options)}<span>${text}</span>`;
}

export function isIconName(value: string | undefined): value is IconName {
  return typeof value === 'string' && iconNames.has(value as IconName);
}

export function initializeStaticIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-hero-icon]').forEach((element) => {
    const iconName = element.dataset.heroIcon;
    if (!isIconName(iconName)) return;
    setIcon(element, iconName);
  });
}

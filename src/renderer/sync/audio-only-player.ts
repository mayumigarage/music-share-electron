/**
 * MusicShare — independent HTML5 Audio player
 *
 * This module is deliberately separate from PlayerProxy and WebContentsView
 * players. It is intended for authorized direct audio URLs returned by the
 * server's audio-only API.
 */

export interface AudioOnlyMetadata {
  audioUrl: string;
  title: string;
  artist?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

export interface AudioOnlySearchResult {
  id: string;
  title: string;
  artist?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

const DEFAULT_AUDIO_API_BASE_URL = 'https://music-share-electron-server.onrender.com';

let audioOnlyPlayer: HTMLAudioElement | null = null;
let currentMetadata: AudioOnlyMetadata | null = null;

function resolveAudioApiBaseUrl(): string {
  const configured = (globalThis as { MUSICSHARE_AUDIO_API_BASE_URL?: string }).MUSICSHARE_AUDIO_API_BASE_URL;
  return configured || DEFAULT_AUDIO_API_BASE_URL;
}

export async function playAudioOnlyMode(sourceId: string): Promise<AudioOnlyMetadata> {
  const apiBaseUrl = resolveAudioApiBaseUrl();
  const endpoint = new URL('/api/get-audio-stream', apiBaseUrl);
  endpoint.searchParams.set('sourceId', sourceId);

  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Audio-only stream request failed: ${response.status}`);
  }

  const metadata = await response.json() as AudioOnlyMetadata;
  if (!metadata.audioUrl) {
    throw new Error('Audio-only stream response did not include audioUrl.');
  }

  stopAudioOnlyMode();

  audioOnlyPlayer = new Audio(metadata.audioUrl);
  audioOnlyPlayer.preload = 'auto';
  audioOnlyPlayer.crossOrigin = 'anonymous';
  audioOnlyPlayer.volume = 1;
  currentMetadata = metadata;

  await audioOnlyPlayer.play();
  return metadata;
}

export async function searchAudioOnlyCatalog(query: string): Promise<AudioOnlySearchResult[]> {
  const apiBaseUrl = resolveAudioApiBaseUrl();
  const endpoint = new URL('/api/search-audio', apiBaseUrl);
  endpoint.searchParams.set('q', query);

  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Audio-only search request failed: ${response.status}`);
  }

  const payload = await response.json() as { results?: AudioOnlySearchResult[] };
  return Array.isArray(payload.results) ? payload.results : [];
}

export function pauseAudioOnlyMode(): void {
  audioOnlyPlayer?.pause();
}

export async function resumeAudioOnlyMode(): Promise<void> {
  if (!audioOnlyPlayer) return;
  await audioOnlyPlayer.play();
}

export function stopAudioOnlyMode(): void {
  if (!audioOnlyPlayer) return;

  audioOnlyPlayer.pause();
  audioOnlyPlayer.removeAttribute('src');
  audioOnlyPlayer.load();
  audioOnlyPlayer = null;
  currentMetadata = null;
}

export function setAudioOnlyVolume(volume: number): void {
  if (!audioOnlyPlayer) return;
  audioOnlyPlayer.volume = Math.min(1, Math.max(0, volume));
}

export function getAudioOnlyMetadata(): AudioOnlyMetadata | null {
  return currentMetadata;
}

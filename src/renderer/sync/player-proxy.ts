/**
 * MusicShare — Player Proxy
 * Phase 6: Abstraction layer for DOM-hosted players.
 */
import { DomYouTubePlayer } from './dom-youtube-player.js';
import { DomVideoPlayer } from './dom-video-player.js';
import { RoomPlayerType, type Track } from '../../shared/models.js';
import type { PlayerMessage } from '../../shared/preload-api.js';

export class StalePlayerLoadError extends Error {
  constructor() {
    super('stale HTML video load request');
    this.name = 'StalePlayerLoadError';
  }
}

export class PlayerProxy {
  private static readonly PRELOAD_AHEAD_COUNT = 3;

  private youtubePlayer = new DomYouTubePlayer();
  private videoPlayer = new DomVideoPlayer();
  private playerType = RoomPlayerType.YouTube;
  private listeners = new Set<(message: PlayerMessage) => void>();
  private htmlVideoLoadRequestId = 0;
  private htmlVideoPreloadRequestId = 0;
  private htmlVideoSourceCache = new Map<string, string>();
  private htmlVideoPreloadedTracks = new Map<string, Track>();

  constructor() {
    this.youtubePlayer.onMessage((message) => {
      if (this.playerType === RoomPlayerType.YouTube) this.emit(message);
    });
    this.videoPlayer.onMessage((message) => {
      if (this.playerType === RoomPlayerType.HtmlVideo) this.emit(message);
    });
    this.setPlayerType(RoomPlayerType.YouTube);
  }

  setPlayerType(playerType: RoomPlayerType): void {
    if (this.playerType !== playerType) {
      this.stop();
    }
    this.playerType = playerType;
    const isVideo = playerType === RoomPlayerType.HtmlVideo;
    document.getElementById('youtube-player')?.style.setProperty('display', isVideo ? 'none' : 'block');
    this.videoPlayer.setVisible(isVideo);
    if (!isVideo) {
      this.htmlVideoSourceCache.clear();
      this.htmlVideoPreloadedTracks.clear();
      this.videoPlayer.preloadTracks([]);
    }
  }

  async loadTrack(track: Track): Promise<void> {
    if (this.playerType === RoomPlayerType.HtmlVideo) {
      const requestId = ++this.htmlVideoLoadRequestId;
      this.videoPlayer.prepareForLoad();
      const sourceUrl = await this.resolveHtmlVideoSource(track);
      if (requestId !== this.htmlVideoLoadRequestId || this.playerType !== RoomPlayerType.HtmlVideo) {
        throw new StalePlayerLoadError();
      }
      return this.videoPlayer.loadTrack({ ...track, url: sourceUrl });
    }
    if (!track.resolvedVideoId) {
      return Promise.reject(new Error('YouTube Music の再生候補を解決できませんでした'));
    }
    return this.youtubePlayer.loadTrack(track.resolvedVideoId);
  }

  play(): void { this.activePlayer().play(); }

  pause(): void { this.activePlayer().pause(); }

  resume(): void { this.activePlayer().play(); }

  stop(): void {
    if (this.playerType === RoomPlayerType.HtmlVideo) {
      this.htmlVideoLoadRequestId++;
    }
    this.activePlayer().stop();
  }

  seek(positionSeconds: number): void { this.activePlayer().seek(positionSeconds); }

  setVolume(volume: number): void { this.activePlayer().setVolume(volume); }

  preloadUpcomingTracks(queue: Track[], currentTrackId: string | null): void {
    if (this.playerType !== RoomPlayerType.HtmlVideo) return;

    const upcoming = this.selectUpcomingTracks(queue, currentTrackId);
    const keepIds = new Set(upcoming.map((track) => track.id));
    for (const trackId of this.htmlVideoSourceCache.keys()) {
      if (!keepIds.has(trackId) && trackId !== currentTrackId) {
        this.htmlVideoSourceCache.delete(trackId);
      }
    }
    for (const trackId of this.htmlVideoPreloadedTracks.keys()) {
      if (!keepIds.has(trackId)) {
        this.htmlVideoPreloadedTracks.delete(trackId);
      }
    }

    const requestId = ++this.htmlVideoPreloadRequestId;
    this.videoPlayer.preloadTracks(this.getResolvedPreloadTracks(upcoming));
    void this.preloadHtmlVideoTracks(upcoming, requestId);
  }

  onMessage(callback: (message: PlayerMessage) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private activePlayer(): DomYouTubePlayer | DomVideoPlayer {
    return this.playerType === RoomPlayerType.HtmlVideo ? this.videoPlayer : this.youtubePlayer;
  }

  private selectUpcomingTracks(queue: Track[], currentTrackId: string | null): Track[] {
    if (queue.length === 0) return [];

    const currentIndex = currentTrackId
      ? queue.findIndex((track) => track.id === currentTrackId)
      : -1;
    const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    return queue.slice(startIndex, startIndex + PlayerProxy.PRELOAD_AHEAD_COUNT);
  }

  private async preloadHtmlVideoTracks(tracks: Track[], requestId: number): Promise<void> {
    await Promise.all(tracks.map(async (track) => {
      try {
        const sourceUrl = await this.resolveHtmlVideoSource(track);
        if (requestId !== this.htmlVideoPreloadRequestId || this.playerType !== RoomPlayerType.HtmlVideo) {
          return;
        }
        this.htmlVideoPreloadedTracks.set(track.id, { ...track, url: sourceUrl });
        this.videoPlayer.preloadTracks(this.getResolvedPreloadTracks(tracks));
      } catch (error) {
        console.warn('[PlayerProxy] Failed to preload track:', track.id, error);
      }
    }));
  }

  private async resolveHtmlVideoSource(track: Track): Promise<string> {
    const cachedSource = this.htmlVideoSourceCache.get(track.id);
    if (cachedSource) return cachedSource;

    const sourceUrl = await window.electronAPI.resolveHtmlVideoSource(track);
    this.htmlVideoSourceCache.set(track.id, sourceUrl);
    return sourceUrl;
  }

  private getResolvedPreloadTracks(tracks: Track[]): Track[] {
    return tracks
      .map((track) => {
        const preloadedTrack = this.htmlVideoPreloadedTracks.get(track.id);
        if (preloadedTrack) return preloadedTrack;

        const cachedSource = this.htmlVideoSourceCache.get(track.id);
        return cachedSource ? { ...track, url: cachedSource } : null;
      })
      .filter((track): track is Track => track !== null);
  }

  private emit(message: PlayerMessage): void {
    this.listeners.forEach((listener) => listener(message));
  }
}

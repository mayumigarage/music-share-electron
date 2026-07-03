import type { Track } from '../../shared/models.js';

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

export function getYouTubeTrackUrl(track: Pick<Track, 'artist' | 'resolvedVideoId' | 'title' | 'url'>): string {
  if (track.resolvedVideoId && YOUTUBE_VIDEO_ID_PATTERN.test(track.resolvedVideoId)) {
    return makeYouTubeWatchUrl(track.resolvedVideoId);
  }

  const videoId = extractYouTubeVideoId(track.url);
  if (videoId) {
    return makeYouTubeWatchUrl(videoId);
  }

  const searchQuery = [track.artist, track.title].filter(Boolean).join(' ').trim() || track.url;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
}

export function openTrackOnYouTube(track: Pick<Track, 'artist' | 'resolvedVideoId' | 'title' | 'url'>): void {
  void window.electronAPI.openExternal(getYouTubeTrackUrl(track));
}

function makeYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
    let videoId: string | null = null;

    if (host === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (host === 'youtube.com' || host === 'music.youtube.com' || host.endsWith('.youtube.com')) {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      } else {
        const [kind, id] = parsed.pathname.split('/').filter(Boolean);
        if (kind === 'shorts' || kind === 'embed' || kind === 'live') videoId = id ?? null;
      }
    }

    return videoId && YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}

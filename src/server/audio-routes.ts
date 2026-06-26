/**
 * MusicShare — Audio-only API routes
 *
 * These routes are independent from the existing embedded player routes.
 * They return metadata and a direct URL for owner-configured / licensed audio
 * resources. The server never proxies audio bytes.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { resolveAuthorizedAudio, searchAudioCatalog } from './audio-catalog';

export interface JsonResponder {
  (response: ServerResponse, statusCode: number, data: unknown): void;
}

export async function handleAudioRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  sendJson: JsonResponder,
): Promise<boolean> {
  if (requestUrl.pathname !== '/api/search-audio' && requestUrl.pathname !== '/api/get-audio-stream') {
    return false;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    });
    response.end();
    return true;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }

  if (requestUrl.pathname === '/api/search-audio') {
    const query = requestUrl.searchParams.get('q') ?? '';
    sendJson(response, 200, { results: searchAudioCatalog(query) });
    return true;
  }

  const sourceId = requestUrl.searchParams.get('sourceId') ?? '';
  const audio = resolveAuthorizedAudio(sourceId);

  if (!audio) {
    sendJson(response, 404, { error: 'Audio source not found' });
    return true;
  }

  sendJson(response, 200, {
    audioUrl: audio.audioUrl,
    title: audio.title,
    artist: audio.artist,
    thumbnailUrl: audio.thumbnailUrl,
    durationSeconds: audio.durationSeconds,
  });
  return true;
}

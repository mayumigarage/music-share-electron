/**
 * MusicShare — Socket.IO Server Entry Point
 * Phase 2: Bootstrap typed Socket.IO server on port 5000
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from '../shared/models';
import { RoomManager } from './room-manager';
import { registerHandlers } from './handlers';
import { getSpotifyTrackMetadata } from './spotify-catalog';
import { handleAudioRoute } from './audio-routes';

const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

function sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    // The desktop application calls this from its Main Process. This header
    // also keeps the endpoint usable if a future web client needs it.
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url || '/', 'http://localhost');

  if (await handleAudioRoute(request, response, requestUrl, sendJson)) {
    return;
  }

  const match = requestUrl.pathname.match(/^\/api\/spotify\/tracks\/([A-Za-z0-9]{22})$/);
  if (request.method !== 'GET' || !match) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const trackId = match[1];
  if (!SPOTIFY_TRACK_ID_PATTERN.test(trackId)) {
    sendJson(response, 400, { error: 'Invalid Spotify track ID' });
    return;
  }

  try {
    const metadata = await getSpotifyTrackMetadata(trackId);
    sendJson(response, 200, metadata);
  } catch (error) {
    // Do not expose provider responses or configuration details to clients.
    console.error('[SpotifyCatalog] Failed to resolve track metadata:', error);
    sendJson(response, 502, { error: 'Spotify metadata is temporarily unavailable' });
  }
}

const httpServer = createServer((request, response) => {
  void handleHttpRequest(request, response);
});
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const roomManager = new RoomManager();
registerHandlers(io, roomManager);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

httpServer.listen(PORT, () => {
  console.log(`MusicShare server listening on port ${PORT}`);
});

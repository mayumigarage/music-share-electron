/**
 * MusicShare — Player Asset Server
 * Serves assets/players/ over http://localhost so WebContentsView
 * has a valid origin for embedded player APIs (YouTube, Spotify, etc.).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { getAssetPath } from './asset-path';

let server: http.Server | null = null;
let serverPort = 0;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

export function startPlayerServer(): Promise<number> {
  if (server) {
    return Promise.resolve(serverPort);
  }

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const reqPath = req.url ? decodeURIComponent(req.url.split('?')[0]) : '/';
      // Only serve under /assets/players/
      if (!reqPath.startsWith('/assets/players/')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      const relativePath = reqPath.slice(1); // remove leading /
      const filePath = getAssetPath(...relativePath.split('/'));

      // Security: prevent directory traversal
      const resolved = path.resolve(filePath);
      const assetsRoot = path.resolve(getAssetPath('assets', 'players'));
      if (!resolved.startsWith(assetsRoot)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      fs.readFile(resolved, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        const ext = path.extname(resolved);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (addr && typeof addr === 'object') {
        serverPort = addr.port;
        console.log(`[PlayerServer] Listening on http://127.0.0.1:${serverPort}`);
        resolve(serverPort);
      } else {
        reject(new Error('Failed to get server port'));
      }
    });

    server.on('error', reject);
  });
}

export function getPlayerServerUrl(): string {
  if (!server || serverPort === 0) {
    throw new Error('Player server is not started');
  }
  return `http://127.0.0.1:${serverPort}`;
}

export function stopPlayerServer(): void {
  if (server) {
    server.close();
    server = null;
    serverPort = 0;
  }
}

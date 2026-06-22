/**
 * Local HTTP server for the renderer bundle.
 *
 * Serving the renderer through http://127.0.0.1 gives third-party embeds a
 * valid origin and referrer. In particular, the YouTube IFrame API rejects
 * file:// documents with error 153 because they have neither.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

let server: http.Server | null = null;
let serverPort = 0;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function getRendererDirectory(): string {
  // __dirname is dist/main/main in development and inside app.asar in a
  // packaged build. The renderer bundle is always at dist/renderer.
  return path.resolve(__dirname, '../../renderer');
}

export function startRendererServer(): Promise<string> {
  if (server) return Promise.resolve(getRendererServerUrl());

  const rendererDirectory = getRendererDirectory();
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const requestPath = request.url ? decodeURIComponent(request.url.split('?')[0]) : '/';
      const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
      const filePath = path.resolve(rendererDirectory, relativePath);

      // Serve only files from the built renderer bundle.
      if (!filePath.startsWith(`${rendererDirectory}${path.sep}`) && filePath !== rendererDirectory) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(error.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
          return;
        }
        response.writeHead(200, {
          'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        response.end(data);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get renderer server address'));
        return;
      }
      serverPort = address.port;
      console.log(`[RendererServer] Listening on ${getRendererServerUrl()}`);
      resolve(getRendererServerUrl());
    });
    server.on('error', reject);
  });
}

export function getRendererServerUrl(): string {
  if (!server || serverPort === 0) throw new Error('Renderer server is not started');
  return `http://127.0.0.1:${serverPort}`;
}

export function stopRendererServer(): void {
  if (!server) return;
  server.close();
  server = null;
  serverPort = 0;
}

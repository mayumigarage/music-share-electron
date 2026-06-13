/**
 * MusicShare — Asset Path Resolver
 * Phase 3.7: Resolve assets/players/ paths for development vs packaged builds
 */

import * as path from 'path';

/**
 * Returns whether the app is running in a packaged (built) environment.
 */
function isPackaged(): boolean {
  return require('electron').app.isPackaged;
}

/**
 * Resolve a path relative to the project assets directory.
 * Works in both development and packaged builds.
 */
export function getAssetPath(...segments: string[]): string {
  if (isPackaged()) {
    // In packaged builds, extraResources copies assets/ to resources/assets/
    return path.join(process.resourcesPath, ...segments);
  }
  // In development, assets/ sits at the project root (three levels above dist/main/main/)
  return path.join(__dirname, '../../../', ...segments);
}

/**
 * Resolve the player HTML file path for a given music service.
 */
export function getPlayerPath(service: string): string {
  const fileName = `${service.charAt(0).toUpperCase() + service.slice(1)}Player.html`;
  return getAssetPath('assets', 'players', fileName);
}

/**
 * Build a player URL via the local asset server.
 * Requires startPlayerServer() to have resolved.
 */
export function getPlayerUrl(service: string, baseUrl: string): string {
  const fileName = `${service.charAt(0).toUpperCase() + service.slice(1)}Player.html`;
  return `${baseUrl}/assets/players/${fileName}`;
}

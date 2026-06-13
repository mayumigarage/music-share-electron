/**
 * MusicShare — Crash Handler
 * Phase 3.17: Catch unhandled exceptions/rejections and append to crash.log
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const CRASH_LOG_FILENAME = 'crash.log';

function getCrashLogPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, CRASH_LOG_FILENAME);
}

function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function appendCrashLog(detail: string): void {
  const logPath = getCrashLogPath();
  const entry = `[${formatTimestamp()}]\n${detail}\n\n`;
  try {
    fs.appendFileSync(logPath, entry, 'utf-8');
  } catch (err) {
    // If even crash logging fails, output to stderr as last resort
    console.error('Failed to write crash.log:', err);
    console.error('Original crash detail:', detail);
  }
}

export function initializeCrashHandler(): void {
  process.on('uncaughtException', (error) => {
    const detail = `Uncaught Exception: ${error.stack || error.message || String(error)}`;
    appendCrashLog(detail);
    // In production, you might want to gracefully restart or show a dialog.
    // For Phase 1 we log and keep running where possible.
    console.error(detail);
  });

  process.on('unhandledRejection', (reason, promise) => {
    const detail = `Unhandled Rejection at: ${promise}\nReason: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`;
    appendCrashLog(detail);
    console.error(detail);
  });
}

/**
 * MusicShare — Crash Handler
 * Phase 3.17: Catch unhandled exceptions/rejections and append to crash.log
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const CRASH_LOG_FILENAME = 'crash.log';
const APP_LOG_FILENAME = 'app.log';

function getLogPath(filename: string): string {
  const userData = app.getPath('userData');
  return path.join(userData, filename);
}

function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function appendCrashLog(detail: string): void {
  appendLog(CRASH_LOG_FILENAME, detail, 'crash');
}

/**
 * Appends a recoverable diagnostic event.  This is intentionally separate
 * from crash.log so expected operational failures remain easy to inspect.
 */
export function appendAppLog(detail: string): void {
  appendLog(APP_LOG_FILENAME, detail, 'application');
}

function appendLog(filename: string, detail: string, kind: string): void {
  const logPath = getLogPath(filename);
  const entry = `[${formatTimestamp()}]\n${detail}\n\n`;
  try {
    fs.appendFileSync(logPath, entry, 'utf-8');
  } catch (err) {
    // If logging fails, output to stderr as the last resort.
    console.error(`Failed to write ${kind} log:`, err);
    console.error('Original log detail:', detail);
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

import type { TerminalSize } from "./types.js";

/**
 * Get the current terminal dimensions.
 */
export function getTerminalSize(): TerminalSize {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  return { rows, cols };
}

/**
 * Check if stdout is a TTY (interactive terminal).
 */
export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

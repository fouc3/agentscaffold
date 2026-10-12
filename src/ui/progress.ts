/**
 * Single-line progress bar rendered with the shared glyph set. Writes to stderr and only when
 * that stream is a TTY, so piping stdout stays clean.
 *
 * One hard requirement, learned from an actual rendering bug: **never emit a line wider than the
 * terminal.** A longer line wraps, and `\r` then returns to the start of the *wrapped* row, so
 * every frame lands on a new line instead of refreshing the same one — the bar "scrolls" instead
 * of animating. Width measurement and truncation live in `./width.js`.
 */
import { erase } from 'sisteransi';
import { dim } from './color.js';
import { getGlyphs, type Glyphs } from './glyphs.js';
import { truncateToWidth, truncateToWidthFromEnd } from './width.js';

export const BAR_WIDTH = 20;
/** Below this the bar is dropped and only the label is shown. */
const MIN_LABEL_WIDTH = 12;
const FALLBACK_COLUMNS = 80;
/** Trailing cell reserved so the cursor never rests in the last column (some terminals wrap there). */
const RESERVE = 1;

/** Paths are cut from the front (the filename matters), prose from the back. */
function fitLabel(label: string, maxWidth: number): string {
  return label.includes('/') ? truncateToWidthFromEnd(label, maxWidth) : truncateToWidth(label, maxWidth);
}

/**
 * Build one frame. Guaranteed to be at most `columns - 1` cells wide; the bar is dropped
 * entirely when the terminal is too narrow to hold it plus a readable label.
 */
export function buildProgressLine(label: string, ratio: number, columns: number, glyphs?: Glyphs): string {
  const g = glyphs ?? getGlyphs();
  const budget = Math.max(1, columns - RESERVE);
  const clampedRatio = Math.min(1, Math.max(0, ratio));

  if (budget >= BAR_WIDTH + 1 + MIN_LABEL_WIDTH) {
    const filled = Math.round(clampedRatio * BAR_WIDTH);
    const bar = `${g.barFilled.repeat(filled)}${g.barEmpty.repeat(BAR_WIDTH - filled)}`;
    return `${bar} ${dim(fitLabel(label, budget - BAR_WIDTH - 1))}`;
  }
  // Too narrow for a bar: label only.
  return dim(fitLabel(label, budget));
}

export interface Progress {
  tick(label: string): void;
  finish(): void;
}

export function createProgress(total: number, stream: NodeJS.WriteStream = process.stderr): Progress {
  const enabled = Boolean(stream.isTTY) && total > 1;
  let current = 0;
  let painted = false;

  // Read the width fresh on every frame: the terminal can be resized mid-run.
  const columns = (): number => {
    const value = stream.columns;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : FALLBACK_COLUMNS;
  };

  return {
    tick(label: string): void {
      current += 1;
      if (!enabled) return;
      const line = buildProgressLine(label, current / total, columns());
      stream.write(`\r${line}${erase.lineEnd}`);
      painted = true;
    },
    finish(): void {
      if (!enabled || !painted) return;
      // Clear the whole line so the report that follows starts clean.
      stream.write(`\r${erase.lineEnd}`);
      painted = false;
    },
  };
}

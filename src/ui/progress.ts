/**
 * Single-line progress bar rendered with the shared glyph set. Writes to stderr and only
 * when that stream is a TTY, so piping stdout stays clean.
 *
 * Two hard requirements, both learned from an actual rendering bug:
 *
 *  1. **Never emit a line wider than the terminal.** A longer line wraps, and `\r` then
 *     returns to the start of the *wrapped* row, so every frame lands on a new line
 *     instead of refreshing the same one — the bar "scrolls" instead of animating.
 *  2. **Measure display width, not string length.** ANSI SGR sequences occupy no cells and
 *     CJK characters occupy two, so `.length` is the wrong number for both the truncation
 *     budget and the leftover-padding calculation.
 */
import { erase } from 'sisteransi';
import { dim } from './color.js';
import { getGlyphs, type Glyphs } from './glyphs.js';

export const BAR_WIDTH = 20;
/** Below this the bar is dropped and only the label is shown. */
const MIN_LABEL_WIDTH = 12;
const FALLBACK_COLUMNS = 80;
/** Trailing cell reserved so the cursor never rests in the last column (some terminals wrap there). */
const RESERVE = 1;

const ANSI_SGR = /\u001b\[[0-9;]*m/g;

/** Display width of a single code point (East Asian Wide / Fullwidth / emoji count as 2). */
function codePointWidth(code: number): number {
  if (code === 0) return 0;
  if (code < 0x1100) return 1;
  const wide =
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, Kangxi
    (code >= 0x3041 && code <= 0x33ff) || // Kana, CJK symbols
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) || // emoji / symbols
    (code >= 0x20000 && code <= 0x3fffd); // CJK Ext B+
  return wide ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += codePointWidth(char.codePointAt(0) ?? 0);
  return width;
}

/** Width as the terminal sees it: SGR escapes take no cells. */
export function visibleWidth(text: string): number {
  return displayWidth(text.replace(ANSI_SGR, ''));
}

/** Truncate to a display-width budget, appending `…`, never splitting a wide character. */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  const ellipsis = '…';
  const budget = maxWidth - displayWidth(ellipsis);
  if (budget <= 0) return ellipsis;
  let used = 0;
  let out = '';
  for (const char of text) {
    const width = codePointWidth(char.codePointAt(0) ?? 0);
    if (used + width > budget) break;
    out += char;
    used += width;
  }
  return `${out}${ellipsis}`;
}

/** Like `truncateToWidth`, but keeps the tail — for paths, the filename is the useful part. */
export function truncateToWidthFromEnd(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  const budget = maxWidth - displayWidth('…');
  if (budget <= 0) return '…';
  const chars = [...text];
  let used = 0;
  const kept: string[] = [];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index] ?? '';
    const width = codePointWidth(char.codePointAt(0) ?? 0);
    if (used + width > budget) break;
    used += width;
    kept.unshift(char);
  }
  return `…${kept.join('')}`;
}

/** Paths are cut from the front, prose from the back. */
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

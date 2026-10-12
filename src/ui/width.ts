/**
 * Terminal text measurement and fitting.
 *
 * Everything here measures **display width**, not string length: ANSI SGR sequences occupy no
 * cells and CJK characters occupy two. Getting that wrong produces either wrapped lines (which
 * break `\r`-based in-place refresh) or ragged boxes.
 */

const ANSI_SGR = /\u001b\[[0-9;]*m/g;

/**
 * Width to pre-wrap `note`/prompt copy to. clack draws a box around it and hard-wraps anything
 * longer, so we leave room for the frame and never hand it a line it would have to break.
 */
export function noteWidth(): number {
  const columns = process.stdout.columns;
  const width = typeof columns === 'number' && columns > 0 ? columns : 80;
  return Math.max(24, Math.min(width - 8, 76));
}

/** Display width of a single code point (East Asian Wide / Fullwidth / emoji count as 2). */
export function codePointWidth(code: number): number {
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

/** Longest prefix that fits the budget, and the remainder. Never splits a wide character. */
function sliceToWidth(text: string, maxWidth: number): [string, string] {
  const chars = [...text];
  let used = 0;
  let index = 0;
  for (; index < chars.length; index += 1) {
    const width = codePointWidth(chars[index]?.codePointAt(0) ?? 0);
    if (used + width > maxWidth) break;
    used += width;
  }
  return [chars.slice(0, index).join(''), chars.slice(index).join('')];
}

/** Truncate to a display-width budget, appending `…`, never splitting a wide character. */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  const budget = maxWidth - displayWidth('…');
  if (budget <= 0) return '…';
  const [head] = sliceToWidth(text, budget);
  return `${head}…`;
}

/** Like `truncateToWidth`, but keeps the tail — for paths, the filename is the useful part. */
export function truncateToWidthFromEnd(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  const budget = maxWidth - displayWidth('…');
  if (budget <= 0) return '…';
  const reversed = [...text].reverse();
  const [tail] = sliceToWidth(reversed.join(''), budget);
  return `…${[...tail].reverse().join('')}`;
}

/**
 * Wrap prose to a display-width budget, breaking between clauses (CJK punctuation, commas,
 * whitespace) rather than mid-word. Without this, clack's own wrapping uses `{hard: true}` and
 * can strand a single character on the next line. Explicit `\n` starts a new line.
 */
export function wrapToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return text;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    // Keep the trailing punctuation attached to its clause; whitespace runs collapse to one word gap.
    const clauses = paragraph.match(/[^，。；：、,;:\s]+[，。；：、,;:]*|\s+/g) ?? [paragraph];
    const flush = (): void => {
      if (current !== '') {
        lines.push(current);
        current = '';
      }
    };
    let current = '';
    let pendingSpace = false;
    for (const raw of clauses) {
      if (raw.trim() === '') {
        if (current !== '') pendingSpace = true;
        continue;
      }
      let rest = raw;
      while (rest !== '') {
        if (current === '') {
          // Fresh line: fits whole, or gets hard-sliced when a single clause is too long.
          const [head, tail] = sliceToWidth(rest, maxWidth);
          if (head === '') {
            rest = '';
            break;
          }
          current = head;
          rest = tail;
          pendingSpace = false;
          if (rest !== '') flush();
          continue;
        }
        const glue = pendingSpace ? ' ' : '';
        if (displayWidth(current) + displayWidth(glue) + displayWidth(rest) <= maxWidth) {
          current += glue + rest;
          rest = '';
          pendingSpace = false;
        } else {
          // The pending space dies at the line break instead of dangling at the end of a line.
          flush();
        }
      }
    }
    flush();
  }
  return lines.join('\n');
}

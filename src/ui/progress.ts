/**
 * Single-line progress bar rendered with the shared glyph set. It writes to stderr
 * and only when that stream is a TTY, so piping stdout stays clean.
 */
import { dim } from './color.js';
import { getGlyphs } from './glyphs.js';

export interface Progress {
  tick(label: string): void;
  finish(): void;
}

export function createProgress(total: number, stream: NodeJS.WriteStream = process.stderr): Progress {
  const enabled = Boolean(stream.isTTY) && total > 1;
  const glyphs = getGlyphs();
  const width = 20;
  let current = 0;
  let lastLength = 0;

  const render = (line: string): void => {
    const pad = lastLength > line.length ? ' '.repeat(lastLength - line.length) : '';
    stream.write(`\r${line}${pad}`);
    lastLength = line.length;
  };

  return {
    tick(label: string): void {
      current += 1;
      if (!enabled) return;
      const ratio = Math.min(1, current / total);
      const filled = Math.round(ratio * width);
      const bar = `${glyphs.barFilled.repeat(filled)}${glyphs.barEmpty.repeat(width - filled)}`;
      render(`${bar} ${dim(label)}`);
    },
    finish(): void {
      if (!enabled) return;
      stream.write(`\r${' '.repeat(lastLength)}\r`);
      lastLength = 0;
    },
  };
}

/**
 * Which build is actually running?
 *
 * `~/.local/bin/agentscaffold` is a symlink into `dist/`, and a rebuild of the checkout updates it
 * silently. Without this, "did my change take effect?" can only be answered by guesswork — which is
 * exactly what happened once: a stale-looking report was assumed to come from an old build.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildInfo {
  /** Absolute path of the running entry module. */
  runningFile: string;
  /** mtime (ISO) of the running build. */
  builtAt: string;
  /** True when the checkout's sources are newer than the built files. */
  stale: boolean;
  /** Newest source file, when we could find one (checkout only). */
  newestSource?: string;
  newestSourceAt?: string;
  /** Checkout root, when the running build sits inside a checkout. */
  checkout?: string;
}

function newestFile(dir: string, filter: (file: string) => boolean): { file: string; mtime: number } | undefined {
  let best: { file: string; mtime: number } | undefined;
  const walk = (current: string, depth: number): void => {
    if (depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const full = join(current, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, depth + 1);
        continue;
      }
      if (!filter(full)) continue;
      const mtime = statSync(full).mtimeMs;
      if (best === undefined || mtime > best.mtime) best = { file: full, mtime };
    }
  };
  walk(dir, 0);
  return best;
}

export function buildInfo(entryUrl: string = import.meta.url): BuildInfo {
  const runningFile = fileURLToPath(entryUrl);
  const builtAt = existsSync(runningFile) ? statSync(runningFile).mtime.toISOString() : new Date(0).toISOString();

  // dist/commands/x.js → checkout root is two levels up; only meaningful in a checkout.
  const root = resolve(dirname(runningFile), '..', '..');
  const srcDir = join(root, 'src');
  if (!existsSync(srcDir)) return { runningFile, builtAt, stale: false };

  const newest = newestFile(srcDir, (file) => file.endsWith('.ts'));
  if (newest === undefined) return { runningFile, builtAt, stale: false };
  const stale = newest.mtime > new Date(builtAt).getTime();
  return {
    runningFile,
    builtAt,
    stale,
    newestSource: relative(root, newest.file),
    newestSourceAt: new Date(newest.mtime).toISOString(),
    checkout: root,
  };
}

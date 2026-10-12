import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export function exists(path: string): boolean {
  return existsSync(path);
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

export function writeText(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, 'utf8');
}

export type WriteOutcome = 'created' | 'updated' | 'unchanged';

/** Write only when the content actually differs, so re-running init is a no-op. */
export function writeTextIfChanged(path: string, content: string): WriteOutcome {
  if (exists(path)) {
    const current = readText(path);
    if (current === content) return 'unchanged';
    writeText(path, content);
    return 'updated';
  }
  writeText(path, content);
  return 'created';
}

/** Recursively list files under `root`, returned as POSIX-style relative paths. */
export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
      } else if (entry.isFile()) {
        out.push(relative(root, abs).split(sep).join('/'));
      }
    }
  };
  visit(root);
  return out.sort();
}

export interface CopyRecord {
  relativePath: string;
  targetPath: string;
  outcome: WriteOutcome | 'overwritten' | 'skipped';
}

export interface CopyTreeOptions {
  force: boolean;
  /** Files that must never be overwritten, matched on the relative path. */
  protect?: (relativePath: string) => boolean;
  onProgress?: (relativePath: string) => void;
}

export function copyTree(src: string, dest: string, options: CopyTreeOptions): CopyRecord[] {
  const records: CopyRecord[] = [];
  for (const rel of walkFiles(src)) {
    const from = join(src, rel);
    const to = join(dest, rel);
    const outgoing = readFileSync(from);
    const target = exists(to) ? readFileSync(to) : undefined;

    let outcome: CopyRecord['outcome'];
    if (target !== undefined && target.equals(outgoing)) {
      outcome = 'unchanged';
    } else if (target !== undefined && !options.force) {
      outcome = 'skipped';
    } else if (target !== undefined) {
      outcome = 'overwritten';
      ensureDir(dirname(to));
      copyFileSync(from, to);
    } else {
      outcome = 'created';
      ensureDir(dirname(to));
      copyFileSync(from, to);
    }

    records.push({ relativePath: rel, targetPath: to, outcome });
    options.onProgress?.(rel);
  }
  return records;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

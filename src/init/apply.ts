import { dirname } from 'node:path';
import { copyTree, ensureDir, exists, readText, writeText, type WriteOutcome } from '../util/fsx.js';
import { allEntries, type EntryOutcome, type InitPlan, type PlannedEntry } from './plan.js';

export interface AppliedRecord {
  relativePath: string;
  outcome: EntryOutcome;
  origin: string;
}

export interface ApplyOptions {
  force: boolean;
  dryRun: boolean;
  onProgress?: (relativePath: string, index: number) => void;
}

export interface ApplyResult {
  records: AppliedRecord[];
  fileCount: number;
}

function previewCopyDir(entry: PlannedEntry, force: boolean): EntryOutcome {
  if (!entry.exists) return 'created';
  return force ? 'overwritten' : 'skipped-tree';
}

export function applyPlan(plan: InitPlan, options: ApplyOptions): ApplyResult {
  const entries = allEntries(plan);
  const records: AppliedRecord[] = [];
  let fileCount = 0;
  let index = 0;

  for (const entry of entries) {
    index += 1;
    options.onProgress?.(entry.relativePath, index);
    records.push(applyEntry(entry, options, (written) => {
      fileCount += written;
    }));
  }

  return { records, fileCount };
}

function applyEntry(entry: PlannedEntry, options: ApplyOptions, addFiles: (count: number) => void): AppliedRecord {
  if (entry.kind === 'copy-dir') {
    if (options.dryRun) {
      return { relativePath: entry.relativePath, outcome: previewCopyDir(entry, options.force), origin: entry.origin };
    }
    const source = entry.source;
    if (source === undefined) throw new Error(`missing source for ${entry.relativePath}`);
    const copied = copyTree(source, entry.absolutePath, { force: options.force });
    const written = copied.filter((record) => record.outcome !== 'unchanged' && record.outcome !== 'skipped').length;
    addFiles(written);
    if (copied.length > 0 && copied.every((record) => record.outcome === 'unchanged')) {
      return { relativePath: entry.relativePath, outcome: 'unchanged', origin: entry.origin };
    }
    if (copied.some((record) => record.outcome === 'skipped')) {
      return { relativePath: entry.relativePath, outcome: 'partial', origin: entry.origin };
    }
    return { relativePath: entry.relativePath, outcome: 'created', origin: entry.origin };
  }

  if (entry.kind === 'copy-file') {
    const source = entry.source;
    if (source === undefined) throw new Error(`missing source for ${entry.relativePath}`);
    const content = readText(source);
    return writeTemplate(entry, content, options, addFiles);
  }

  const content = entry.content ?? '';
  return writeTemplate(entry, content, options, addFiles);
}

function writeTemplate(
  entry: PlannedEntry,
  content: string,
  options: ApplyOptions,
  addFiles: (count: number) => void,
): AppliedRecord {
  if (options.dryRun) {
    const outcome: EntryOutcome = !exists(entry.absolutePath)
      ? 'created'
      : readText(entry.absolutePath) === content
        ? 'unchanged'
        : options.force
          ? 'overwritten'
          : 'skipped';
    return { relativePath: entry.relativePath, outcome, origin: entry.origin };
  }

  ensureDir(dirname(entry.absolutePath));
  let outcome: WriteOutcome | 'overwritten' | 'skipped';
  if (!exists(entry.absolutePath)) {
    writeText(entry.absolutePath, content);
    outcome = 'created';
  } else if (readText(entry.absolutePath) === content) {
    outcome = 'unchanged';
  } else if (options.force) {
    writeText(entry.absolutePath, content);
    outcome = 'overwritten';
  } else {
    outcome = 'skipped';
  }
  if (outcome === 'created' || outcome === 'overwritten') addFiles(1);
  return { relativePath: entry.relativePath, outcome, origin: entry.origin };
}

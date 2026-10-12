/**
 * Install manifest: what `init` actually put on disk, per scope.
 *
 * This exists so `uninstall` can remove exactly the files we added instead of guessing. An entry
 * is recorded only when the file on disk is byte-identical to the version we install, and its
 * `sha256` is that content — so removal can tell "still ours" from "the user edited it since".
 */
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { exists, readText, writeText, walkFiles, isDirectory } from '../util/fsx.js';
import { scopePaths, type Scope } from './scope.js';
import { allEntries, type InitPlan, type PlannedEntry } from './plan.js';

export const MANIFEST_SCHEMA = 'agentscaffold/manifest@1';
export const MANIFEST_RELATIVE_PATH = join('.agents', 'agentscaffold.manifest.json');

export interface ManifestEntry {
  /** Path relative to the scope root, POSIX-style. */
  path: string;
  /** sha256 of the content we installed. */
  sha256: string;
  origin: string;
  thirdParty: boolean;
}

export interface Manifest {
  schema: string;
  tool: string;
  version: string;
  scope: Scope;
  projectRoot: string;
  installedAt: string;
  claude: boolean;
  packs: string[];
  skills: string[];
  entries: ManifestEntry[];
}

export function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function manifestPath(scope: Scope, projectRoot: string): string {
  return join(scopePaths(scope, projectRoot).root, MANIFEST_RELATIVE_PATH);
}

/** Resolve a manifest entry to an absolute path (entries are scope-root relative). */
export function entryAbsolutePath(scope: Scope, projectRoot: string, entryPath: string): string {
  return join(scopePaths(scope, projectRoot).root, entryPath);
}

export function readManifest(path: string): Manifest | undefined {
  if (!exists(path)) return undefined;
  try {
    const parsed = JSON.parse(readText(path)) as Manifest;
    return parsed.schema === MANIFEST_SCHEMA ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeManifest(path: string, manifest: Manifest): void {
  writeText(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Files from the plan that are currently on disk byte-identical to what we install, i.e. the
 * ones we can honestly claim as ours.
 */
export function collectInstalledFiles(plan: InitPlan): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const planned of allEntries(plan)) {
    for (const candidate of expandEntry(planned)) {
      if (!exists(candidate.target)) continue;
      const installed = sha256OfFile(candidate.source);
      if (sha256OfFile(candidate.target) !== installed) continue;
      entries.push({
        path: candidate.relativePath,
        sha256: installed,
        origin: planned.origin,
        thirdParty: planned.thirdParty,
      });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

interface Candidate {
  relativePath: string;
  target: string;
  source: string;
}

/** One planned entry can cover many files (a directory copy) — list them concretely. */
function expandEntry(entry: PlannedEntry): Candidate[] {
  if (entry.kind === 'copy-dir') {
    const root = entry.source;
    if (root === undefined || !isDirectory(root)) return [];
    return walkFiles(root).map((file) => ({
      relativePath: `${entry.relativePath}/${file}`,
      target: join(entry.absolutePath, file),
      source: join(root, file),
    }));
  }
  if (entry.source !== undefined) {
    return [{ relativePath: entry.relativePath, target: entry.absolutePath, source: entry.source }];
  }
  // Template entries are compared by content, not by a source file.
  const absolute = entry.absolutePath;
  const content = entry.content ?? '';
  const digest = createHash('sha256').update(content).digest('hex');
  if (!exists(absolute) || sha256OfFile(absolute) !== digest) return [];
  return [{ relativePath: entry.relativePath, target: absolute, source: absolute }];
}

/** Keep entries from a previous manifest that this run did not touch (e.g. another scope's skills). */
export function mergeEntries(previous: ManifestEntry[] | undefined, next: ManifestEntry[]): ManifestEntry[] {
  if (previous === undefined) return next;
  const byPath = new Map<string, ManifestEntry>();
  for (const entry of previous) byPath.set(entry.path, entry);
  for (const entry of next) byPath.set(entry.path, entry);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export interface DetectedInstall {
  scope: Scope;
  manifestPath: string;
  manifest: Manifest;
}

/** Which scopes have a manifest, most recent first. */
export function detectInstalls(projectRoot: string): DetectedInstall[] {
  const found: DetectedInstall[] = [];
  for (const scope of ['project', 'user'] as const) {
    const path = manifestPath(scope, projectRoot);
    const manifest = readManifest(path);
    if (manifest !== undefined) found.push({ scope, manifestPath: path, manifest });
  }
  return found.sort((a, b) => b.manifest.installedAt.localeCompare(a.manifest.installedAt));
}

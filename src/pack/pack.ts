import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { exists, isDirectory, readJson, walkFiles } from '../util/fsx.js';

export interface PackCli {
  /** Executable name to look up on PATH. */
  name: string;
  /** A missing required CLI makes the skill unusable rather than merely weaker. */
  required: boolean;
  why?: string;
  /** Accepted minimum version, compared against the first dotted number found. */
  minVersion?: string;
  /** Command a human can run to install it. Never executed by this tool. */
  install?: string;
  /** What still works when the CLI is absent. */
  fallback?: string;
}

export interface PackSkill {
  name: string;
  /** Directory inside the pack root that holds SKILL.md and its references. */
  dir: string;
}

export interface PackUpstream {
  repo: string;
  path: string;
  commit: string;
  license: string;
  /** License-bearing files kept verbatim under `upstream/`. */
  files: string[];
  modifications?: string;
}

export interface PackManifest {
  name: string;
  version: string;
  description: string;
  license: string;
  upstream?: PackUpstream;
  skills: PackSkill[];
  cli: PackCli[];
}

export interface LoadedPack extends PackManifest {
  root: string;
  manifestPath: string;
  fileCount: number;
}

export function packsDir(): string {
  const override = process.env.AGENTSCAFFOLD_PACKS_DIR;
  if (override !== undefined && override.length > 0) return override;
  return fileURLToPath(new URL('../../packs/', import.meta.url));
}

export function loadPacks(dir: string = packsDir()): LoadedPack[] {
  if (!isDirectory(dir)) return [];
  const packs: LoadedPack[] = [];
  for (const entry of walkFiles(dir)) {
    if (!entry.endsWith('/pack.json')) continue;
    const manifestPath = join(dir, entry);
    const manifest = readJson<PackManifest>(manifestPath);
    const root = manifestPath.slice(0, manifestPath.length - '/pack.json'.length);
    packs.push({ ...manifest, root, manifestPath, fileCount: walkFiles(root).length });
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name));
}

export function selectPacks(all: LoadedPack[], only: string[] | undefined): LoadedPack[] {
  if (only === undefined || only.length === 0) return all;
  return all.filter((pack) => only.includes(pack.name));
}

export function packSkillRoot(pack: LoadedPack, skill: PackSkill): string {
  return join(pack.root, skill.dir);
}

export function packUpstreamRoot(pack: LoadedPack): string | undefined {
  const root = join(pack.root, 'upstream');
  return exists(root) ? root : undefined;
}

export function totalSkillFiles(packs: LoadedPack[], extraRoots: string[]): number {
  let count = extraRoots.length;
  for (const pack of packs) {
    for (const skill of pack.skills) {
      const root = packSkillRoot(pack, skill);
      if (isDirectory(root)) count += walkFiles(root).length;
      if (pack.upstream !== undefined) count += 2; // LICENSE + THIRD-PARTY-NOTICES
    }
  }
  return count;
}

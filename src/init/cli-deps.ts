import { spawnSync } from 'node:child_process';
import { getGlyphs } from '../ui/glyphs.js';
import { dim, green, red, yellow } from '../ui/color.js';
import type { LoadedPack, PackCli } from '../pack/pack.js';

export interface ToolStatus {
  name: string;
  required: boolean;
  found: boolean;
  version?: string;
  minVersion?: string;
  versionOk: boolean;
  why?: string;
  install?: string;
  installArgv?: string[];
  fallback?: string;
  usedBy: string[];
}

/** `--version` first, falling back to `-v`; ENOENT means "not installed". */
export function probeTool(name: string): { found: boolean; version?: string } {
  for (const flag of ['--version', '-v']) {
    const result = spawnSync(name, [flag], { encoding: 'utf8', timeout: 5000 });
    if (result.error !== undefined && result.error !== null) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { found: false };
      continue;
    }
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const firstLine = text.split('\n').find((line) => line.trim().length > 0) ?? '';
    if (firstLine.length > 0) {
      return { found: true, version: firstLine.trim().slice(0, 80) };
    }
    return { found: true };
  }
  return { found: false };
}

function numbersIn(text: string): number[] {
  const match = text.match(/\d+(?:\.\d+)*/);
  if (match === null) return [];
  return match[0].split('.').map((part) => Number.parseInt(part, 10));
}

function meetsMinimum(found: string | undefined, minimum: string | undefined): boolean {
  if (minimum === undefined) return true;
  if (found === undefined) return false;
  const a = numbersIn(found);
  const b = numbersIn(minimum);
  if (a.length === 0 || b.length === 0) return true; // unparseable: do not block
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export function collectToolRequirements(packs: LoadedPack[]): Array<PackCli & { usedBy: string[] }> {
  const byName = new Map<string, PackCli & { usedBy: string[] }>();
  for (const pack of packs) {
    for (const cli of pack.cli) {
      const existing = byName.get(cli.name);
      if (existing === undefined) {
        byName.set(cli.name, { ...cli, usedBy: [pack.name] });
      } else {
        existing.usedBy.push(pack.name);
        existing.required = existing.required || cli.required;
        existing.installArgv ??= cli.installArgv;
      }
    }
  }
  return [...byName.values()].sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
}

export function probePacks(packs: LoadedPack[]): ToolStatus[] {
  return collectToolRequirements(packs).map((cli) => {
    const probed = probeTool(cli.name);
    return {
      name: cli.name,
      required: cli.required,
      found: probed.found,
      version: probed.version,
      minVersion: cli.minVersion,
      versionOk: probed.found && meetsMinimum(probed.version, cli.minVersion),
      why: cli.why,
      install: cli.install,
      installArgv: cli.installArgv,
      fallback: cli.fallback,
      usedBy: cli.usedBy,
    };
  });
}

export function formatToolLine(status: ToolStatus): string {
  const glyphs = getGlyphs();
  const label = status.found ? green(status.name) : status.required ? red(status.name) : yellow(status.name);
  const version = status.version === undefined ? '' : ` ${dim(status.version)}`;
  if (!status.found) {
    const kind = status.required ? red('missing (required)') : yellow('missing (optional)');
    return `${glyphs.err} ${label} — ${kind}${version}`;
  }
  if (!status.versionOk) {
    return `${glyphs.warn} ${label} — ${yellow(`older than ${status.minVersion ?? 'required'}`)}${version}`;
  }
  return `${glyphs.ok} ${label}${version}`;
}

export function formatToolDetails(status: ToolStatus): string[] {
  const lines: string[] = [];
  if (status.why !== undefined) lines.push(`   ${dim('why')}      ${status.why}`);
  if (!status.found || !status.versionOk) {
    if (status.install !== undefined) lines.push(`   ${dim('install')}  ${status.install}`);
    if (status.fallback !== undefined) lines.push(`   ${dim('fallback')} ${status.fallback}`);
  }
  return lines;
}

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { getGlyphs } from '../ui/glyphs.js';
import { dim, green, red, yellow } from '../ui/color.js';
import { exists } from '../util/fsx.js';
import type { LoadedPack, PackCli } from '../pack/pack.js';
import { CODEGRAPH_INSTALL, CODEGRAPH_INSTALL_WITH } from '../search/code.js';
import { toolsBinDir } from './tools-prefix.js';

export interface ToolStatus {
  name: string;
  required: boolean;
  found: boolean;
  version?: string;
  minVersion?: string;
  versionOk: boolean;
  /** Where it was found: on PATH, or only in our private prefix (not usable everywhere yet). */
  source?: 'PATH' | 'agentscaffold-tools';
  why?: string;
  install?: string;
  installArgv?: string[];
  installWith?: { manager: 'npm' | 'cargo'; package: string };
  fallback?: string;
  usedBy: string[];
}

/**
 * `--version` first, falling back to `-v`; ENOENT means "not installed".
 *
 * Also looks in our private prefix (`~/.agents/tools/bin`). Without that, a tool we just installed
 * there is reported as missing on the very next probe — the contradiction the user hit. The
 * returned `source` lets the report say *where* it was found, so "found but not on PATH" is visible
 * instead of silently pretending it is usable everywhere.
 */
export function probeTool(name: string): { found: boolean; version?: string; source?: 'PATH' | 'agentscaffold-tools' } {
  const inPath = probeBinary(name);
  if (inPath.found) return { ...inPath, source: 'PATH' };
  const local = join(toolsBinDir(), name);
  if (exists(local)) {
    const probed = probeBinary(local);
    if (probed.found) return { ...probed, source: 'agentscaffold-tools' };
  }
  return { found: false };
}

function probeBinary(nameOrPath: string): { found: boolean; version?: string } {
  for (const flag of ['--version', '-v']) {
    const result = spawnSync(nameOrPath, [flag], { encoding: 'utf8', timeout: 5000 });
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

  // Tool-level (not pack-level) optional dependencies. Same reporting, same opt-in install and
  // the same "here is the fallback" contract: codegraph only accelerates `agentscaffold search`
  // (symbols, definitions, call graphs); text search runs on ripgrep alone and always works.
  byName.set('codegraph', {
    name: 'codegraph',
    required: false,
    why: '检索的符号 / 定义 / 调用关系后端（可选加速器；文本检索只需 ripgrep）',
    install: CODEGRAPH_INSTALL,
    installWith: CODEGRAPH_INSTALL_WITH,
    fallback: '不装也能用：agentscaffold search <关键词> --kind text',
    usedBy: ['检索'],
  });

  for (const pack of packs) {
    // `cli` is data from a hand-written pack.json: tolerate it being missing entirely.
    for (const cli of pack.cli ?? []) {
      const existing = byName.get(cli.name);
      if (existing === undefined) {
        byName.set(cli.name, { ...cli, usedBy: [pack.name] });
      } else {
        existing.usedBy.push(pack.name);
        existing.required = existing.required || cli.required;
        existing.installWith ??= cli.installWith;
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
      source: probed.source,
      why: cli.why,
      install: cli.install,
      installArgv: cli.installArgv,
      installWith: cli.installWith,
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
  const scope = status.source === 'agentscaffold-tools' ? ` ${dim('（在自用前缀，未加进 PATH）')}` : '';
  return `${glyphs.ok} ${label}${version}${scope}`;
}

export function formatToolDetails(status: ToolStatus): string[] {
  const lines: string[] = [];
  if (status.why !== undefined) lines.push(`   ${dim('why')}      ${status.why}`);
  if (status.source === 'agentscaffold-tools') {
    lines.push(
      `   ${dim('location')} ${join(toolsBinDir(), status.name)}`,
      `   ${dim('note')}     加进 PATH 才能在别处直接用：export PATH="${toolsBinDir()}:$PATH"`,
    );
  }
  if (!status.found || !status.versionOk) {
    if (status.install !== undefined) lines.push(`   ${dim('install')}  ${status.install}`);
    if (status.fallback !== undefined) lines.push(`   ${dim('fallback')} ${status.fallback}`);
  }
  return lines;
}

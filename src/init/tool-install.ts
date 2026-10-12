/**
 * Optional tool packages — installed into **our own prefix**, never globally.
 *
 * Why this shape:
 *   - The machine's npm global prefix is `/usr` (not writable by the user). Running `npm i -g`
 *     there always downloads first and then fails with EACCES, leaving npm cache entries and
 *     debug logs behind — a failed install with side effects, which is exactly what happened.
 *   - So every install goes to `~/.agents/tools` (npm `--prefix`, cargo `--root`). That directory
 *     is ours: it can be listed, removed, and undone as a unit, and it needs no privileges.
 *
 * Rules that keep pack data from becoming code execution:
 *   - Only tools whose pack declares a structured `installWith` are ever offered. The old raw
 *     `installArgv` array is kept for humans to read but is **never executed**.
 *   - We build the argv ourselves (`npm install --prefix …`), so pack data cannot inject flags.
 *   - Managers we cannot isolate (pip, system package managers) are never run; they stay advice.
 *   - Nothing is installed without the user picking it (TUI) or passing --install-tools.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolStatus } from './cli-deps.js';

export type Manager = 'npm' | 'cargo';

export interface InstallTarget {
  name: string;
  manager: Manager;
  package: string;
}

export interface InstallOutcome {
  name: string;
  manager: Manager;
  command: string;
  ok: boolean;
  detail: string;
  needsPrivileges: boolean;
}

export interface InstalledRecord {
  name: string;
  manager: Manager;
  package: string;
  argv: string[];
  installedAt: string;
}

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const RECORD_FILE = 'installed.json';

/** Our private prefix. Overridable so tests never touch the real one. */
export function toolsDir(): string {
  const override = process.env.AGENTSCAFFOLD_TOOLS_DIR;
  if (override !== undefined && override.length > 0) return override;
  return join(process.env.HOME ?? process.cwd(), '.agents', 'tools');
}

export function toolsBinDir(): string {
  return join(toolsDir(), 'bin');
}

function managerBinary(manager: Manager): string {
  const override = manager === 'npm' ? process.env.AGENTSCAFFOLD_NPM : process.env.AGENTSCAFFOLD_CARGO;
  if (override !== undefined && override.length > 0) return override;
  return manager;
}

export function managerAvailable(manager: Manager): boolean {
  const result = spawnSync(managerBinary(manager), ['--version'], { encoding: 'utf8', timeout: 10_000 });
  return result.error === undefined || result.error === null;
}

/** Missing tools whose pack declared an install we can actually isolate. */
export function installableMissing(statuses: ToolStatus[]): ToolStatus[] {
  return statuses.filter(
    (status) =>
      !status.found &&
      status.installWith !== undefined &&
      (status.installWith.manager === 'npm' || status.installWith.manager === 'cargo'),
  );
}

/** Tools that are only ever advice (pip, system package managers, raw argv). */
export function advisoryOnly(statuses: ToolStatus[]): ToolStatus[] {
  return statuses.filter((status) => !status.found && status.installWith === undefined);
}

/** Build the isolated argv ourselves — never take an argv array from pack data. */
export function isolatedArgv(target: InstallTarget, dir: string = toolsDir()): string[] {
  if (target.manager === 'npm') {
    return [
      managerBinary('npm'),
      'install',
      '--prefix',
      dir,
      '--no-fund',
      '--no-audit',
      '--no-package-lock',
      '--loglevel',
      'error',
      target.package,
    ];
  }
  return [managerBinary('cargo'), 'install', '--root', dir, '--locked', target.package];
}

/** Pre-flight: can this install possibly succeed without privileges? */
export function canInstall(target: InstallTarget, dir: string = toolsDir()): { ok: boolean; reason?: string } {
  if (!managerAvailable(target.manager)) {
    return { ok: false, reason: `找不到 ${target.manager}（它本身没装或不在 PATH 上）` };
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `创建 ${dir} 失败：${(error as Error).message}` };
  }
  const probe = join(dir, '.write-probe');
  try {
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
  } catch (error) {
    return { ok: false, reason: `${dir} 不可写：${(error as Error).message}` };
  }
  return { ok: true };
}

function readRecord(dir: string): InstalledRecord[] {
  const file = join(dir, RECORD_FILE);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { installed?: InstalledRecord[] };
    return Array.isArray(parsed.installed) ? parsed.installed : [];
  } catch {
    return [];
  }
}

function writeRecord(dir: string, records: InstalledRecord[]): void {
  writeFileSync(join(dir, RECORD_FILE), `${JSON.stringify({ tool: 'agentscaffold', prefix: dir, installed: records }, null, 2)}\n`);
}

export function listInstalled(dir: string = toolsDir()): InstalledRecord[] {
  return readRecord(dir);
}

const PRIVILEGE_HINTS = [/EACCES/i, /permission denied/i, /operation not permitted/i, /are you root/i];

function tail(text: string, lines = 3): string {
  return text
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-lines)
    .join(' / ');
}

async function runArgv(argv: string[], timeoutMs: number): Promise<{ ok: boolean; output: string; error?: string }> {
  const [bin, ...args] = argv;
  return await new Promise((resolve) => {
    const child = spawn(bin as string, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, output, error: `超过 ${Math.round(timeoutMs / 60000)} 分钟未完成，已中止` });
    }, timeoutMs);

    // Ctrl-C during an install: stop the child and say what our prefix now contains, because
    // "the terminal came back" is not the same as "nothing was left behind".
    const onSigint = (): void => {
      child.kill('SIGTERM');
      process.stdout.write(`\n已中断。${prefixStateNote()}\n`);
      process.exit(130);
    };
    process.once('SIGINT', onSigint);

    const done = (value: { ok: boolean; output: string; error?: string }): void => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);
      resolve(value);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => done({ ok: false, output, error: error.message }));
    child.on('close', (code) => done({ ok: code === 0, output, error: code === 0 ? undefined : tail(output) }));
  });
}

/** What our prefix currently holds — used in failure/interrupt messages. */
export function prefixStateNote(dir: string = toolsDir()): string {
  if (!existsSync(dir)) return `自用目录 ${dir} 不存在，没有留下东西。`;
  const records = readRecord(dir);
  if (records.length === 0) return `${dir} 里没有安装记录（可能有半成品，用 agentscaffold tools --remove-all 清掉）。`;
  return `${dir} 里有 ${records.length} 个已记录的工具：${records.map((record) => record.name).join('、')}。`;
}

export async function runInstall(target: InstallTarget, dir: string = toolsDir()): Promise<InstallOutcome> {
  const preflight = canInstall(target, dir);
  const command = isolatedArgv(target, dir).join(' ');
  if (!preflight.ok) {
    // Do not run what cannot work: that is what turned a permission error into downloaded cache.
    return {
      name: target.name,
      manager: target.manager,
      command,
      ok: false,
      detail: `未执行（${preflight.reason}）`,
      needsPrivileges: false,
    };
  }

  const argv = isolatedArgv(target, dir);
  const result = await runArgv(argv, INSTALL_TIMEOUT_MS);
  if (result.ok) {
    const records = readRecord(dir).filter((record) => record.name !== target.name);
    records.push({
      name: target.name,
      manager: target.manager,
      package: target.package,
      argv,
      installedAt: new Date().toISOString(),
    });
    writeRecord(dir, records);
    return { name: target.name, manager: target.manager, command, ok: true, detail: '', needsPrivileges: false };
  }
  return {
    name: target.name,
    manager: target.manager,
    command,
    ok: false,
    detail: result.error ?? tail(result.output),
    needsPrivileges: PRIVILEGE_HINTS.some((pattern) => pattern.test(result.output)),
  };
}

export async function runInstalls(
  targets: InstallTarget[],
  onStart: (target: InstallTarget) => void,
  dir: string = toolsDir(),
): Promise<InstallOutcome[]> {
  const outcomes: InstallOutcome[] = [];
  for (const target of targets) {
    onStart(target);
    outcomes.push(await runInstall(target, dir));
  }
  return outcomes;
}

export interface RemovalOutcome {
  name: string;
  ok: boolean;
  detail: string;
}

/** Undo one install through its own manager; falls back to deleting our two known paths. */
export async function removeTool(name: string, dir: string = toolsDir()): Promise<RemovalOutcome> {
  const record = readRecord(dir).find((item) => item.name === name);
  if (record === undefined) return { name, ok: false, detail: '安装记录里没有它' };

  const argv =
    record.manager === 'npm'
      ? [managerBinary('npm'), 'uninstall', '--prefix', dir, '--no-fund', '--no-audit', record.package]
      : [managerBinary('cargo'), 'uninstall', '--root', dir, record.package];
  const result = await runArgv(argv, 120_000);
  let ok = result.ok;

  if (!ok) {
    // Manager gone or unhappy: remove what we know we put there.
    const modulePath = join(dir, 'lib', 'node_modules', record.package);
    rmSync(modulePath, { recursive: true, force: true });
    rmSync(join(toolsBinDir(), name), { force: true });
    ok = true;
  }

  writeRecord(
    dir,
    readRecord(dir).filter((item) => item.name !== name),
  );
  return { name, ok, detail: ok ? '' : tail(result.output) };
}

/** Remove everything we installed here, then the dir itself when nothing is left. */
export async function removeAll(dir: string = toolsDir()): Promise<RemovalOutcome[]> {
  const records = readRecord(dir);
  const outcomes: RemovalOutcome[] = [];
  for (const record of records) outcomes.push(await removeTool(record.name, dir));
  rmSync(dir, { recursive: true, force: true });
  return outcomes;
}

/** The PATH line a user needs, and whether it is already effective. */
export function pathHint(dir: string = toolsDir()): { binDir: string; onPath: boolean; line: string } {
  const binDir = join(dir, 'bin');
  const onPath = (process.env.PATH ?? '')
    .split(':')
    .some((entry) => entry === binDir);
  return { binDir, onPath, line: `export PATH="${binDir}:$PATH"` };
}

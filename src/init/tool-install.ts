/**
 * Optional tool packages: the CLIs a skill would like to have, installed **with consent**.
 *
 * Rules that keep this from being a foot-gun:
 *  - Only tools whose pack declares `installArgv` are ever offered. A pack may list an `install`
 *    string for humans without granting us permission to run anything.
 *  - The command is executed as argv, never through a shell, so pack data cannot inject shell syntax.
 *  - Nothing is installed unless the user picks it (TUI) or passes --install-tools (non-interactive).
 *  - A failure is reported with the exact command; we never retry and never escalate to sudo.
 *
 * Runs asynchronously on purpose: a synchronous spawn would freeze the event loop, and the
 * progress spinner (or any other output) would sit motionless for the whole `cargo install`.
 */
import { spawn } from 'node:child_process';
import type { ToolStatus } from './cli-deps.js';

export interface InstallOutcome {
  name: string;
  command: string;
  ok: boolean;
  /** Last few lines of output, for the failure report. */
  detail: string;
  /** True when the failure looks like a permissions problem we cannot fix ourselves. */
  needsPrivileges: boolean;
}

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

/** Missing tools whose pack declared a runnable install command. */
export function installableMissing(statuses: ToolStatus[]): ToolStatus[] {
  return statuses.filter(
    (status) => !status.found && Array.isArray(status.installArgv) && status.installArgv.length > 0,
  );
}

function tail(text: string, lines = 4): string {
  return text
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-lines)
    .join('\n');
}

const PRIVILEGE_HINTS = [/EACCES/i, /permission denied/i, /operation not permitted/i, /are you root/i, /sudo/i];

export async function runInstall(status: ToolStatus): Promise<InstallOutcome> {
  const argv = status.installArgv ?? [];
  const command = argv.join(' ');
  const [bin, ...args] = argv;
  if (bin === undefined) {
    return { name: status.name, command, ok: false, detail: '缺少安装命令', needsPrivileges: false };
  }

  return await new Promise<InstallOutcome>((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        name: status.name,
        command,
        ok: false,
        detail: `超过 ${Math.round(INSTALL_TIMEOUT_MS / 60000)} 分钟未完成，已中止`,
        needsPrivileges: false,
      });
    }, INSTALL_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ name: status.name, command, ok: false, detail: error.message, needsPrivileges: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const failed = tail(output);
      resolve({
        name: status.name,
        command,
        ok: code === 0,
        detail: code === 0 ? '' : failed,
        needsPrivileges: code !== 0 && PRIVILEGE_HINTS.some((pattern) => pattern.test(output)),
      });
    });
  });
}

/** Install the given tools in order; `onStart` lets the caller show progress for each one. */
export async function runInstalls(
  statuses: ToolStatus[],
  onStart: (status: ToolStatus) => void,
): Promise<InstallOutcome[]> {
  const outcomes: InstallOutcome[] = [];
  for (const status of statuses) {
    onStart(status);
    outcomes.push(await runInstall(status));
  }
  return outcomes;
}

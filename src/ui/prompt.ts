/**
 * Prompt layer. Everything interactive goes through @clack/prompts (the same TUI
 * toolkit @colbymchenry/codegraph uses), so the init wizard looks and behaves the
 * way that CLI does: `intro` frame, `select`/`multiselect`/`confirm` steps, `note`
 * blocks for plans and `outro` to close.
 *
 * Non-interactive rule: no prompts when --yes was passed, when stdin/stdout is not
 * a TTY, or when AGENTSCAFFOLD_NO_TUI=1. Callers must branch on `interactive()`.
 */
import * as clack from '@clack/prompts';

export { clack };

export function interactive(): boolean {
  if (process.env.AGENTSCAFFOLD_NO_TUI === '1') return false;
  if (process.env.CI !== undefined && process.env.AGENTSCAFFOLD_FORCE_TUI !== '1') return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function cancelled(message = 'Cancelled — nothing was written.'): never {
  clack.cancel(message);
  process.exit(0);
}

/** Unwrap a clack answer, exiting cleanly when the user hit Ctrl-C / Esc. */
export function answer<T>(value: T | symbol): T {
  if (clack.isCancel(value)) cancelled();
  return value as T;
}

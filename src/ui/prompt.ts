/**
 * Prompt layer. Everything interactive goes through @clack/prompts (the same TUI
 * toolkit @colbymchenry/codegraph uses), so the init wizard looks and behaves the
 * way that CLI does: `intro` frame, `select`/`multiselect`/`confirm` steps, `note`
 * blocks for plans and `outro` to close.
 *
 * Non-interactive rule: no prompts when --yes was passed, when stdin/stdout is not
 * a TTY, or when AGENTSCAFFOLD_NO_TUI=1. Callers must branch on `interactive()`.
 *
 * Prompt copy convention (follow it when adding a step):
 *   1. The message is the decision itself: 「是否 <动作>？」 or 「<动作>？」.
 *   2. No first person — 「要我…」「帮你…」 are wrong; a CLI does not talk about itself.
 *   3. The reason or constraint goes in a trailing parenthesis, mirroring codegraph's
 *      "Install the codegraph CLI on your PATH? (Required so agents can launch …)".
 *   4. Anything longer than one line belongs in a `note` block above the prompt,
 *      pre-wrapped with `wrapToWidth()` so clack never hard-breaks a phrase.
 */
import * as clack from '@clack/prompts';

export { clack };

export function interactive(): boolean {
  if (process.env.AGENTSCAFFOLD_NO_TUI === '1') return false;
  if (process.env.CI !== undefined && process.env.AGENTSCAFFOLD_FORCE_TUI !== '1') return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function cancelled(message = '已取消，未做任何修改。'): never {
  clack.cancel(message);
  process.exit(0);
}

/** Unwrap a clack answer, exiting cleanly when the user hit Ctrl-C / Esc. */
export function answer<T>(value: T | symbol): T {
  if (clack.isCancel(value)) cancelled();
  return value as T;
}

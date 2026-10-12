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
 *
 * Exit handling lives here, and it is state-aware on purpose. Steps that come *after*
 * files were written (the optional-tools step, the commit step) can still be cancelled;
 * saying "未做任何修改" there would be a lie, and the user would not know the install
 * already happened or how to undo it. So a step that writes calls `recordWritten()`, and
 * both cancel paths then describe the real state of the disk.
 *
 * Two different things, two different exit codes:
 *   - Ctrl-C / Esc (`isCancel`) → `interrupted()` → exit 130 (the shell convention for
 *     "terminated by SIGINT"), so scripts can tell it apart from success.
 *   - answering "No" to a confirm → `declined()` → exit 0 (a clean, deliberate no).
 */
import * as clack from '@clack/prompts';

export { clack };

export function interactive(): boolean {
  if (process.env.AGENTSCAFFOLD_NO_TUI === '1') return false;
  if (process.env.CI !== undefined && process.env.AGENTSCAFFOLD_FORCE_TUI !== '1') return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

interface WrittenState {
  /** One line describing what is already on disk. */
  summary: string;
  /** How the user gets back to the previous state. */
  undo?: string;
}

let written: WrittenState | undefined;

/**
 * Call right after a step succeeded in writing something. Any later cancel will then tell
 * the truth: what was written, and how to undo it.
 */
export function recordWritten(summary: string, undo?: string): void {
  written = { summary, undo };
  // A Ctrl-C can also arrive as a signal rather than through clack's cancel path.
  process.once('SIGINT', () => {
    report('中断');
    process.exit(130);
  });
}

export function clearWritten(): void {
  written = undefined;
}

/** "本次已写入 …（撤销：…）" when something was written, otherwise the honest "没动过". */
export function stateNote(): string {
  if (written === undefined) return '未做任何修改。';
  return `本次已经写入：${written.summary}${written.undo === undefined ? '' : `\n  撤销：${written.undo}`}`;
}

function report(label: string): void {
  process.stdout.write(`\n${label} — ${stateNote()}\n`);
}

/** Ctrl-C / Esc: the user stopped a step midway. */
export function interrupted(message?: string): never {
  clack.cancel(message ?? `已中断。${stateNote()}`);
  process.exit(130);
}

/** The user answered "No" to a confirm: a clean, deliberate decision. */
export function declined(message: string): never {
  clack.cancel(`${message}${written === undefined ? '' : `（${stateNote()}）`}`);
  process.exit(0);
}

/**
 * Kept for compatibility with existing call sites that cannot tell the two apart yet.
 * Prefer `interrupted()` / `declined()`.
 */
export function cancelled(message?: string): never {
  interrupted(message);
}

/** Unwrap a clack answer, exiting (state-aware) when the user hit Ctrl-C / Esc. */
export function answer<T>(value: T | symbol): T {
  if (clack.isCancel(value)) interrupted();
  return value as T;
}

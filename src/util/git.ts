/**
 * The only place this tool touches git.
 *
 * Deliberate limits: we stage and commit **only the paths this run touched** (`git commit --only`
 * semantics via a pathspec), never `git add -A`, and we never push — the generated AGENTS.md tells
 * agents not to push without approval, and this tool holds itself to the same rule.
 */
import { spawnSync } from 'node:child_process';

export interface GitRun {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CommitResult {
  ok: boolean;
  hash?: string;
  error?: string;
}

function run(cwd: string, args: string[]): GitRun {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

export function gitAvailable(): boolean {
  const result = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  return result.status === 0;
}

export function isGitRepo(root: string): boolean {
  const result = run(root, ['rev-parse', '--is-inside-work-tree']);
  return result.status === 0 && result.stdout.trim() === 'true';
}

export function hasChanges(root: string, paths: string[]): boolean {
  if (paths.length === 0) return false;
  const result = run(root, ['status', '--porcelain', '--', ...paths]);
  return result.stdout.trim() !== '';
}

export function stageAndCommit(root: string, paths: string[], message: string): CommitResult {
  if (!gitAvailable()) return { ok: false, error: '未找到 git' };
  if (!isGitRepo(root)) return { ok: false, error: `${root} 不是 git 仓库` };
  if (paths.length === 0) return { ok: false, error: '没有需要提交的路径' };

  const add = run(root, ['add', '--', ...paths]);
  if (add.status !== 0) return { ok: false, error: `git add 失败：${add.stderr.trim()}` };

  if (!hasChanges(root, paths)) {
    return { ok: false, error: '本次涉及的路径没有改动（可能已经提交过）' };
  }

  // The pathspec gives `--only` semantics: unrelated staged changes stay staged, uncommitted.
  const commit = run(root, ['commit', '-m', message, '--', ...paths]);
  if (commit.status !== 0) {
    const detail = (commit.stderr.trim() || commit.stdout.trim()).split('\n').slice(0, 3).join(' / ');
    return { ok: false, error: `git commit 失败：${detail}` };
  }
  const hash = run(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  return hash === '' ? { ok: true } : { ok: true, hash };
}

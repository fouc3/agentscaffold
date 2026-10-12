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

export interface InitRepoResult {
  ok: boolean;
  branch?: string;
  error?: string;
}

/** `git init -b main`, falling back to plain `git init` on git versions without `-b`. */
export function initRepo(root: string): InitRepoResult {
  const withBranch = run(root, ['init', '-b', 'main']);
  if (withBranch.status === 0) return { ok: true, branch: 'main' };

  const plain = run(root, ['init']);
  if (plain.status !== 0) {
    return { ok: false, error: (plain.stderr.trim() || withBranch.stderr.trim()).split('\n')[0] ?? '未知错误' };
  }
  const branch = run(root, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  return { ok: true, ...(branch === '' ? {} : { branch }) };
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
    const raw = commit.stderr.trim() || commit.stdout.trim();
    // A missing identity is a very common first-run failure; say exactly what to run.
    if (/who are you|作者身份未知|unable to auto-detect email|user\.email|user\.name/i.test(raw)) {
      return {
        ok: false,
        error:
          '还没有配置 git 身份。请先运行：\n' +
          '    git config --global user.name "你的名字"\n' +
          '    git config --global user.email "you@example.com"\n' +
          '  然后重新运行本命令，或在仓库里手动提交。',
      };
    }
    const detail = raw.split('\n').slice(0, 3).join(' / ');
    return { ok: false, error: `git commit 失败：${detail}` };
  }
  const hash = run(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  return hash === '' ? { ok: true } : { ok: true, hash };
}

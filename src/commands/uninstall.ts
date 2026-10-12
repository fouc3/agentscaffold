import { dirname, resolve, sep } from 'node:path';
import { readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { exists } from '../util/fsx.js';
import { toolVersion } from '../util/version.js';
import { getGlyphs } from '../ui/glyphs.js';
import { bold, dim, green, red, yellow } from '../ui/color.js';
import { answer, clack, declined, interactive, recordWritten } from '../ui/prompt.js';
import { displayPath, scopeLabel, scopePaths, type Scope } from '../init/scope.js';
import {
  MANIFEST_RELATIVE_PATH,
  detectInstalls,
  entryAbsolutePath,
  manifestPath,
  readManifest,
  sha256OfFile,
  writeManifest,
  type DetectedInstall,
} from '../init/manifest.js';
import { gitAvailable, hasChanges, initRepo, isGitRepo, stageAndCommit } from '../util/git.js';

export interface UninstallFlags {
  scope?: string;
  yes: boolean;
  force: boolean;
  dryRun: boolean;
  commit: boolean;
}

interface RemovalFile {
  /** Path relative to the scope root. */
  path: string;
  absolute: string;
}

export interface RemovalPlan {
  target: DetectedInstall;
  remove: RemovalFile[];
  keptModified: RemovalFile[];
  missing: RemovalFile[];
  /** Directories the manifest put files into; anything still non-empty holds unmanaged files. */
  managedDirs: string[];
}

export function buildRemovalPlan(target: DetectedInstall, projectRoot: string, force: boolean): RemovalPlan {
  const remove: RemovalFile[] = [];
  const keptModified: RemovalFile[] = [];
  const missing: RemovalFile[] = [];
  const managedDirs = new Set<string>();
  const root = scopePaths(target.scope, projectRoot).root;

  for (const entry of target.manifest.entries) {
    const absolute = entryAbsolutePath(target.scope, projectRoot, entry.path);
    const parent = dirname(absolute);
    if (parent !== root) managedDirs.add(parent);
    const file: RemovalFile = { path: entry.path, absolute };

    if (!exists(absolute)) {
      missing.push(file);
    } else if (force || sha256OfFile(absolute) === entry.sha256) {
      remove.push(file);
    } else {
      keptModified.push(file);
    }
  }
  return { target, remove, keptModified, missing, managedDirs: [...managedDirs].sort() };
}

export interface RemovalResult {
  deleted: number;
  prunedDirs: number;
}

function isEmptyDir(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

/** Delete the recorded files, then prune every directory that our deletions emptied. */
export function applyRemoval(plan: RemovalPlan, projectRoot: string, dryRun: boolean): RemovalResult {
  let deleted = 0;
  const touchedDirs = new Set<string>();
  for (const file of plan.remove) {
    if (!dryRun) unlinkSync(file.absolute);
    deleted += 1;
    touchedDirs.add(dirname(file.absolute));
  }

  let prunedDirs = 0;
  if (!dryRun) {
    const root = scopePaths(plan.target.scope, projectRoot).root;
    const insideRoot = (dir: string): boolean => dir === root || dir.startsWith(`${root}${sep}`);
    const starts = [...touchedDirs].sort((a, b) => b.split(sep).length - a.split(sep).length);
    for (const start of starts) {
      let dir = start;
      while (dir !== root && insideRoot(dir)) {
        if (!isEmptyDir(dir)) break;
        try {
          rmdirSync(dir);
          prunedDirs += 1;
        } catch {
          break;
        }
        dir = dirname(dir);
      }
    }
  }
  return { deleted, prunedDirs };
}

export interface CommitInput {
  projectRoot: string;
  paths: string[];
  summary: string;
}

export interface CommitOutcome {
  committed: boolean;
  hash?: string;
  /** True when this step had to run `git init` first. */
  initialized?: boolean;
  skipped?: string;
  error?: string;
}

/**
 * Shared by init and uninstall: ask (or honour `--commit`) and commit **only** the touched paths.
 * When the directory is not a repository yet the question becomes "initialize git and commit?",
 * because that is the only way the requested commit can happen. Never pushes.
 */
export async function maybeCommit(input: CommitInput, options: { tty: boolean; commit: boolean }): Promise<CommitOutcome> {
  if (input.paths.length === 0) return { committed: false };
  if (!gitAvailable()) return { committed: false, skipped: '未找到 git，跳过提交' };

  if (!isGitRepo(input.projectRoot)) {
    if (options.tty) {
      const yes = answer<boolean>(
        await clack.confirm({
          message: `${input.summary}\n当前目录还不是 git 仓库。是否初始化 git 并提交本次改动？（只提交本次涉及的路径，不会 push）`,
          initialValue: false,
        }),
      );
      if (!yes) return { committed: false, skipped: '未初始化 git，已跳过提交' };
    } else if (!options.commit) {
      return { committed: false, skipped: '不是 git 仓库且未加 --commit，跳过提交' };
    }

    const inited = initRepo(input.projectRoot);
    if (!inited.ok) return { committed: false, error: `git init 失败：${inited.error ?? ''}` };
    const created = stageAndCommit(input.projectRoot, input.paths, `chore: ${input.summary}`);
    if (!created.ok) return { committed: false, initialized: true, error: created.error };
    return { committed: true, initialized: true, ...(created.hash === undefined ? {} : { hash: created.hash }) };
  }

  // Nothing to commit (e.g. re-running init over an identical tree) — do not even ask.
  const hasChange = hasChanges(input.projectRoot, input.paths);
  if (options.tty) {
    if (!hasChange) return { committed: false, skipped: '本次涉及的路径没有改动，无需提交' };
    const yes = answer<boolean>(
      await clack.confirm({
        message: `${input.summary}\n是否将本次改动提交到当前仓库？（只提交本次涉及的路径，不会 push）`,
        initialValue: false,
      }),
    );
    if (!yes) return { committed: false, skipped: '已跳过提交' };
  } else if (!options.commit) {
    return { committed: false, skipped: '未加 --commit，跳过提交' };
  } else if (!hasChange) {
    return { committed: false, skipped: '本次涉及的路径没有改动，无需提交' };
  }

  const result = stageAndCommit(input.projectRoot, input.paths, `chore: ${input.summary}`);
  if (!result.ok) return { committed: false, error: result.error };
  return { committed: true, ...(result.hash === undefined ? {} : { hash: result.hash }) };
}

export async function runUninstall(pathArg: string | undefined, flags: UninstallFlags): Promise<number> {
  const projectRoot = resolve(pathArg ?? process.cwd());
  const tty = interactive() && !flags.yes;
  const glyphs = getGlyphs();
  const installs = detectInstalls(projectRoot);

  if (installs.length === 0) {
    process.stderr.write(`${red('错误')}：未发现由 agentscaffold 安装的内容。\n`);
    process.stderr.write(`  已查找 ${manifestPath('project', projectRoot)}\n`);
    process.stderr.write(`  已查找 ${manifestPath('user', projectRoot)}\n`);
    process.stderr.write('  没有安装清单就无法安全判断哪些文件是我们装的，所以不做任何猜测性删除。\n');
    return 2;
  }

  const requested = flags.scope;
  if (requested !== undefined && requested !== 'user' && requested !== 'project') {
    process.stderr.write(`${red('错误')}：--scope 只支持 user 或 project。\n`);
    return 2;
  }

  let target: DetectedInstall;
  if (requested !== undefined) {
    const found = installs.find((install) => install.scope === requested);
    if (found === undefined) {
      process.stderr.write(
        `${red('错误')}：${scopeLabel(requested as Scope)} 没有安装清单（现有：${installs.map((i) => i.scope).join('、')}）。\n`,
      );
      return 2;
    }
    target = found;
  } else if (tty) {
    // Always offer the choice, even with a single scope installed.
    const picked = answer<string>(
      await clack.select<string>({
        message: '卸载哪个安装？',
        options: installs.map((install) => ({
          value: install.scope,
          label: scopeLabel(install.scope),
          hint: `${install.manifest.entries.length} 个文件 · ${install.manifest.installedAt.slice(0, 10)}`,
        })),
      }),
    );
    target = installs.find((install) => install.scope === picked) ?? installs[0]!;
  } else if (installs.length === 1) {
    target = installs[0]!;
  } else {
    process.stderr.write(
      `${red('错误')}：发现多个安装（${installs.map((i) => i.scope).join('、')}），非交互模式请用 --scope 指定。\n`,
    );
    return 2;
  }

  const plan = buildRemovalPlan(target, projectRoot, flags.force);
  const summary = [
    `作用域    ${bold(scopeLabel(target.scope))}`,
    `安装清单  ${displayPath(manifestPath(target.scope, projectRoot), target.scope, projectRoot)}`,
    `将删除    ${plan.remove.length} 个文件`,
    `已保留    ${plan.keptModified.length} 个（安装后被改过）${plan.keptModified.length > 0 ? dim('；要一并删除请加 --force') : ''}`,
    `已不存在  ${plan.missing.length} 个`,
  ].join('\n');

  if (tty) {
    clack.intro(`${bold('agentscaffold')} uninstall ${dim(`v${toolVersion}`)}`);
    clack.note(summary, '即将移除');
    const ok = answer<boolean>(await clack.confirm({ message: '是否移除以上文件？', initialValue: false }));
    if (!ok) declined('已取消，未删除任何文件。');
  } else {
    process.stdout.write(`${bold('agentscaffold')} uninstall ${flags.dryRun ? '(dry-run)' : ''}\n${summary}\n`);
  }

  // Remove the manifest before pruning when nothing is kept: it lives in a directory we may prune,
  // and leaving it behind would keep that directory non-empty (e.g. an empty `.agents/`).
  const manifest = manifestPath(target.scope, projectRoot);
  const keepsFiles = plan.keptModified.length > 0;
  if (!flags.dryRun && !keepsFiles && exists(manifest)) unlinkSync(manifest);

  const result = applyRemoval(plan, projectRoot, flags.dryRun);
  if (!flags.dryRun) {
    // A cancel later in the flow (the commit step) must report what was already removed.
    recordWritten(
      `已移除 ${plan.remove.length} 个文件` + (plan.keptModified.length > 0 ? `，保留 ${plan.keptModified.length} 个（安装后被改过）` : ''),
      plan.keptModified.length > 0 ? `agentscaffold uninstall --force` : undefined,
    );
  }

  // Files the user edited stay behind, so keep a manifest listing exactly those: a later run
  // (optionally with --force) can still finish the job instead of losing the record.
  if (!flags.dryRun && keepsFiles) {
    const previous = readManifest(manifest);
    if (previous !== undefined) {
      const kept = new Set(plan.keptModified.map((file) => file.path));
      writeManifest(manifest, { ...previous, entries: previous.entries.filter((entry) => kept.has(entry.path)) });
    }
  }

  const report: string[] = [];
  for (const file of plan.remove) {
    report.push(`  ${glyphs.err} ${displayPath(file.absolute, target.scope, projectRoot)} ${dim('[removed]')}`);
  }
  for (const file of plan.keptModified) {
    report.push(`  ${glyphs.warn} ${displayPath(file.absolute, target.scope, projectRoot)} ${yellow('[kept: 安装后被修改]')}`);
  }
  for (const dir of plan.managedDirs) {
    if (exists(dir) && !isEmptyDir(dir)) {
      report.push(`  ${glyphs.info} ${displayPath(dir, target.scope, projectRoot)} ${dim('[保留：目录非空]')}`);
    }
  }
  process.stdout.write(`${report.join('\n')}\n`);
  process.stdout.write(
    `${green('完成')} — 删除 ${result.deleted} 个文件，清理 ${result.prunedDirs} 个空目录` +
      `${flags.dryRun ? dim('（dry-run，未落盘）') : ''}\n`,
  );
  if (keepsFiles && !flags.dryRun) {
    process.stdout.write(
      `${dim(`清单已保留 ${plan.keptModified.length} 条：再次运行 uninstall 可继续处理，--force 会连同修改一起删除`)}\n`,
    );
  }

  // Only a project-scope install lives inside a repository worth committing.
  if (target.scope === 'project') {
    const committed = await maybeCommit(
      {
        projectRoot,
        paths: [...plan.remove.map((file) => file.path), MANIFEST_RELATIVE_PATH],
        summary: `移除 agentscaffold 安装的 agent 技能与开发要求文档（v${toolVersion}）`,
      },
      { tty, commit: flags.commit },
    );
    if (committed.committed) {
      process.stdout.write(
        `${green('已提交')} ${committed.hash ?? ''}${committed.initialized === true ? dim('（含 git init）') : ''}\n`,
      );
    } else if (committed.error !== undefined) {
      process.stdout.write(
        `${yellow('未提交')}：${committed.error}${committed.initialized === true ? dim('（git 仓库已初始化）') : ''}\n`,
      );
    } else if (committed.skipped !== undefined && !tty) {
      process.stdout.write(`${dim(committed.skipped)}\n`);
    }
  }

  if (tty) clack.outro(`${green('卸载完成')} — ${scopeLabel(target.scope)}`);
  return 0;
}

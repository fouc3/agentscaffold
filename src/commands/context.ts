/**
 * `agentscaffold context` — evaluate the mechanical context rules for a change set.
 *
 * This is the piece Firefox's `review-context.toml` covers with Review Helper: given the files a
 * patch touches, decide *mechanically* which docs/skills must be read, instead of hoping a model
 * notices them. We stop at producing the list — injecting it into someone's prompt is the host's
 * job, so this stays usable from a review bot, CI, or an agent.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { bold, dim, green, red, yellow } from '../ui/color.js';
import {
  RULES_RELATIVE_PATH,
  dedupeLoads,
  evaluateRules,
  normalizeLoad,
  readRules,
  rulesPathFor,
  validateRules,
  type ContextRule,
  type Predicate,
} from '../rules/context.js';

export interface ContextFlags {
  changed: string[];
  since?: string;
  range?: string;
  rules?: string;
  check: boolean;
  list: boolean;
  init: boolean;
  json: boolean;
}

/** Turn a predicate into one readable line — the "why did this rule fire" explanation. */
export function describePredicate(predicate: Predicate | Record<string, unknown>): string {
  const object = predicate as Record<string, unknown>;
  const fileParts = (value: Record<string, unknown>): string => {
    const parts: string[] = [];
    if (Array.isArray(value.include)) parts.push(`路径匹配 ${(value.include as string[]).join('、')}`);
    if (Array.isArray(value.exclude)) parts.push(`路径不匹配 ${(value.exclude as string[]).join('、')}`);
    if (Array.isArray(value.ext)) parts.push(`扩展名 ${(value.ext as string[]).join('、')}`);
    return parts.length > 0 ? parts.join(' 且 ') : '任意文件';
  };
  const inner = (value: unknown, joiner = ' 或 '): string =>
    Array.isArray(value)
      ? value.map((item) => describePredicate(item as Predicate)).join(joiner)
      : isFilePredicate(value)
        ? fileParts(value as Record<string, unknown>)
        : describePredicate(value as Predicate);

  if (isFilePredicate(object)) return fileParts(object);
  if ('any_file' in object) return `至少一个改动文件：${inner(object.any_file)}`;
  if ('all_files' in object) return `每个改动文件都：${inner(object.all_files)}`;
  if ('all' in object) return `同时满足：${inner(object.all, ' 且 ')}`;
  if ('any' in object) return `满足任一：${inner(object.any)}`;
  if ('not' in object) return `不满足：${inner(object.not)}`;
  return JSON.stringify(object);
}

function isFilePredicate(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 && keys.every((key) => ['include', 'exclude', 'ext'].includes(key));
}

/**
 * Changed files from git.
 *   --since <ref>  → `git diff --name-only <ref>`: the working tree against that ref.
 *   --range <a...b> → passed through verbatim: the PR-style three-dot comparison.
 * (Using `<ref>...HEAD` for both was wrong: `--since HEAD` would compare HEAD with itself.)
 */
function changedFromGit(
  projectRoot: string,
  since: string | undefined,
  range: string | undefined,
): { files: string[]; error?: string; source: string } {
  const args =
    range !== undefined
      ? ['diff', '--name-only', range]
      : since === undefined
        ? ['diff', '--name-only', 'HEAD']
        : ['diff', '--name-only', since];
  const label = `git ${args.join(' ')}`;
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
  if (result.error !== undefined && result.error !== null) return { files: [], error: '当前环境没有 git', source: label };
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim().split('\n')[0] ?? `退出码 ${result.status}`;
    return { files: [], error: `${label} 失败：${detail}`, source: label };
  }
  const files = (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { files, source: label };
}

const STARTER_TOML = `# 机械触发的上下文规则（照 Firefox 的 review-context.toml 做的）
#
# 用途：给定一次改动涉及的文件，机械决定该读哪些文档/技能 —— 不靠模型自己想起来。
# 校验：agentscaffold context --check
# 试跑：agentscaffold context --since HEAD
#
# 谓词：any_file（至少一个改动文件满足）、all_files（每个都满足，适合「只改文档」这类形状规则）、
#       all / any / not 组合；文件谓词有 include / exclude / ext（fnmatch 语义，* 也匹配 /）。
# 加载：load 里写 { type = "file", path = "..." }（文件）、{ skill = "技能名" }（已安装技能），
#       或直接写一个字符串路径。

version = 1
description = "按改动的文件机械决定该读哪些文档/技能"

# 示例：同时碰 WebIDL 与 C++ 时读 Web 标准实现约定
# [[rules]]
# name = "WebIDL 实现"
# description = "补丁同时动 WebIDL 定义与 C++ 实现时加载。"
# when = { all = [
#   { any_file = { ext = [".webidl"] } },
#   { any_file = { ext = [".h", ".cpp"] } },
# ] }
# load = [
#   { type = "file", path = "docs/webidl-guide.md" },
# ]
`;

export function runContext(projectRootArg: string | undefined, flags: ContextFlags): number {
  const projectRoot = resolve(projectRootArg ?? process.cwd());
  const rulesFile = rulesPathFor(projectRoot, flags.rules);

  if (flags.init) {
    if (existsSync(rulesFile)) {
      process.stderr.write(`${red('错误')}：${rulesFile} 已存在，不覆盖。\n`);
      return 1;
    }
    mkdirSync(dirname(rulesFile), { recursive: true });
    writeFileSync(rulesFile, STARTER_TOML);
    process.stdout.write(
      `${green('已创建')} ${rulesFile}\n\n` +
        '把上面注释里的 [[rules]] 例子取消注释就能用；TOML 支持注释，所以规则文件可以自己解释自己。\n' +
        `改完用 ${bold('agentscaffold context --check')} 校验，用 ${bold('agentscaffold context --since HEAD')} 看该读什么。\n`,
    );
    return 0;
  }

  if (!existsSync(rulesFile)) {
    process.stderr.write(
      `${yellow('没有规则文件')}：${rulesFile}\n` +
        `  用 ${bold('agentscaffold context --init')} 生成一个，或用 --rules <path> 指定。\n` +
        '  （这套机制照 Firefox 的 review-context.toml 实现：同样的谓词与 load 写法，规则可以搬过来用。）\n',
    );
    return 1;
  }

  let loaded;
  try {
    loaded = readRules(rulesFile);
  } catch (error) {
    process.stderr.write(`${red('错误')}：规则文件解析失败：${(error as Error).message}\n`);
    return 2;
  }
  if (loaded === undefined) {
    process.stderr.write(`${red('错误')}：读不到规则文件 ${rulesFile}\n`);
    return 2;
  }
  const rules = loaded.rules;

  if (flags.check) {
    const issues = validateRules(rules);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ file: rulesFile, ok: issues.length === 0, issues }, null, 2)}\n`);
    } else if (issues.length === 0) {
      process.stdout.write(`${green('规则有效')}：${rules.rules.length} 条（${rulesFile}）\n`);
    } else {
      process.stdout.write(`${red('规则有问题')}：${issues.length} 处（${rulesFile}）\n`);
      for (const issue of issues) process.stdout.write(`  ${issue.where}：${issue.message}\n`);
    }
    return issues.length === 0 ? 0 : 2;
  }

  if (flags.list) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ file: rulesFile, rules: rules.rules }, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${bold('上下文规则')} ${dim(`(${rulesFile})`)}\n`);
    if (rules.rules.length === 0) process.stdout.write('  （还没有规则）\n');
    for (const rule of rules.rules) {
      process.stdout.write(`  ${bold(rule.name)}${rule.priority === undefined ? '' : dim(` [priority ${rule.priority}]`)}\n`);
      process.stdout.write(`    什么时候：${describePredicate(rule.when)}\n`);
      for (const raw of rule.load) {
        const entry = normalizeLoad(raw);
        const target = entry.skill ?? entry.path ?? entry.file ?? '?';
        process.stdout.write(`    读：${entry.skill === undefined ? target : `技能 ${target}`}\n`);
      }
    }
    return 0;
  }

  const issues = validateRules(rules);
  if (issues.length > 0) {
    process.stderr.write(`${red('规则有问题')}，先修：\n`);
    for (const issue of issues) process.stderr.write(`  ${issue.where}：${issue.message}\n`);
    return 2;
  }

  let changed = flags.changed;
  let source = '手动指定';
  if (changed.length === 0) {
    const fromGit = changedFromGit(projectRoot, flags.since, flags.range);
    if (fromGit.error !== undefined) {
      process.stderr.write(`${red('错误')}：${fromGit.error}\n  用 --changed <文件...> 手动指定改动文件。\n`);
      return 2;
    }
    changed = fromGit.files;
    source = fromGit.source;
  }

  const result = evaluateRules(projectRoot, rules, changed);
  const loads = dedupeLoads(result.matched);

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          tool: 'agentscaffold',
          rules_file: rulesFile,
          changed_source: source,
          changed: result.changed,
          matched: result.matched.map((match) => ({
            rule: match.rule.name,
            description: match.rule.description,
            why: describePredicate(match.rule.when),
            load: match.loads.map((load) => ({
              kind: load.kind,
              declared: load.declared,
              path: load.display,
              exists: load.resolved !== undefined,
              skill: load.skillName,
              summary: load.summary,
            })),
          })),
          load: loads.map((load) => load.display ?? load.declared),
          problems: result.problems,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines: string[] = [];
  lines.push(`# 本次改动的上下文`);
  lines.push('');
  lines.push(`改动文件 ${result.changed.length} 个（来源：${source}）：`);
  if (result.changed.length === 0) lines.push('- （没有改动文件）');
  for (const file of result.changed) lines.push(`- ${file}`);
  lines.push('');

  if (result.matched.length === 0) {
    lines.push('没有规则命中——要么这些改动不需要额外上下文，要么还缺一条规则。');
  } else {
    for (const match of result.matched) {
      lines.push(`## 命中：${match.rule.name}`);
      lines.push('');
      if (match.rule.description !== undefined) lines.push(match.rule.description);
      lines.push(`- 为什么：${describePredicate(match.rule.when)}`);
      for (const load of match.loads) {
        if (load.resolved === undefined) {
          lines.push(`- ${red('缺失')}：${load.declared}（${load.kind === 'skill' ? '技能未安装' : '文件不存在'}）`);
          continue;
        }
        const label = load.kind === 'skill' ? `技能 ${load.skillName}` : '文件';
        const summary = load.summary === undefined ? '' : `，${dim(load.summary)}`;
        lines.push(`- 读 ${label}：\`${load.display}\`${summary}`);
      }
      lines.push('');
    }
    if (loads.length > 0) {
      lines.push('把上面这些文件的内容作为受信任上下文，放在 diff 之前（对齐 Firefox Review Helper 的注入顺序）；');
      lines.push('同一条内容只加载一次。');
    }
  }
  if (result.problems.length > 0) {
    lines.push('');
    lines.push(`${yellow('注意')}：`);
    for (const problem of result.problems) lines.push(`- ${problem}`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);

  // Missing load targets are non-fatal: the change set still got evaluated (Firefox logs and proceeds).
  if (result.problems.length > 0) process.stderr.write(`${yellow('提示')}：有 load 目标不存在，见上面「注意」。\n`);
  return 0;
}

/** A rule longer than the terminal is unreadable; keep the summary short. */
export function ruleSummary(rule: ContextRule): string {
  return `${rule.name} — ${describePredicate(rule.when)}`;
}

export function starterRulesPath(projectRoot: string): string {
  return join(resolve(projectRoot), RULES_RELATIVE_PATH);
}

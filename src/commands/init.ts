import { resolve } from 'node:path';
import { applyPlan } from '../init/apply.js';
import { allEntries, buildInitPlan, type EntryOutcome, type InitPlan } from '../init/plan.js';
import { scopePaths, type Scope } from '../init/scope.js';
import { loadPacks, type LoadedPack } from '../pack/pack.js';
import { formatToolDetails, formatToolLine, probePacks } from '../init/cli-deps.js';
import { createProgress } from '../ui/progress.js';
import { getGlyphs } from '../ui/glyphs.js';
import { bold, cyan, dim, green, red, yellow } from '../ui/color.js';
import { answer, cancelled, clack, interactive } from '../ui/prompt.js';
import { toolVersion } from '../util/version.js';

export interface InitFlags {
  scope?: string;
  yes: boolean;
  force: boolean;
  dryRun: boolean;
  claude: boolean;
  skills?: string[];
  noSkills: boolean;
  acceptMplNotice: boolean;
}

function parseScope(value: string | undefined): Scope {
  if (value === undefined) return 'user';
  if (value === 'user' || value === 'project') return value;
  throw new Error(`未知作用域 "${value}"，只支持 user 或 project。`);
}

function mplPacks(packs: LoadedPack[]): LoadedPack[] {
  return packs.filter((pack) => pack.upstream !== undefined);
}

/** Install-scope choice copy. Shown once, at scope selection. */
function scopeChoiceMessage(packs: LoadedPack[]): string {
  const mpl = mplPacks(packs).length;
  return `安装范围（本包含 ${mpl} 个带 MPL-2.0 文件的技能包）`;
}

/** Project-scope confirmation copy: this is the only place the full wall is shown. */
function projectScopeNotice(packs: LoadedPack[], projectRoot: string): string {
  const lines: string[] = [
    '你将把技能包装到当前项目：',
    `  ${projectRoot}/.agents/skills/...`,
    '',
    '其中部分文件为 MPL-2.0。请确认：',
    '- 你项目的其他代码不会因此变成 MPL，也不要求开源。',
    '- 这些 MPL 文件若随项目再分发，请保留 LICENSE、THIRD_PARTY_NOTICES 和文件头声明。',
    '- 若你修改并再分发这些 MPL 文件，需公开修改后的这些文件。',
    '- 不要把 MPL 文件内容合并进你自己的源文件；合并后的文件可能受 MPL 约束。',
    '- 请勿使用 Mozilla/Firefox 名称或 logo 暗示官方背书。',
    '',
    '详细文件清单：运行 agentscaffold --license',
    'agent / 合规扫描：agentscaffold --license --json',
  ];
  const upstream = mplPacks(packs)
    .map((pack) => pack.upstream)
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  if (upstream.length > 0) {
    lines.push('', '上游来源:');
    for (const item of upstream) {
      lines.push(`  ${item.repo} :: ${item.path} @ ${item.commit.slice(0, 12)}`);
    }
  }
  return lines.join('\n');
}

const OUTCOME_LABEL: Record<EntryOutcome, (text: string) => string> = {
  created: green,
  overwritten: cyan,
  unchanged: dim,
  skipped: yellow,
  'skipped-tree': yellow,
  partial: yellow,
};

export async function runInit(pathArg: string | undefined, flags: InitFlags): Promise<number> {
  const projectRoot = resolve(pathArg ?? process.cwd());
  const availablePacks = loadPacks();
  const tty = interactive() && !flags.yes;

  let scope: Scope;
  try {
    scope = parseScope(flags.scope);
  } catch (error) {
    process.stderr.write(`${red('错误')}：${(error as Error).message}\n`);
    return 2;
  }

  let claude = flags.claude;
  let only = flags.skills;
  let skipSkills = flags.noSkills || availablePacks.length === 0;
  let accepted = flags.acceptMplNotice;

  if (tty) {
    clack.intro(`${bold('agentscaffold')} init ${dim(`v${toolVersion}`)}`);

    scope = answer<string>(
      await clack.select<string>({
        message: scopeChoiceMessage(availablePacks),
        initialValue: flags.scope === undefined ? 'user' : scope,
        options: [
          {
            value: 'user',
            label: '用户级（推荐）',
            hint: '安装到 ~/.agents/skills；仅当前用户可用，不进入项目仓库，不把 MPL 文件带入你的项目。',
          },
          {
            value: 'project',
            label: '项目级',
            hint: '安装到 <project>/.agents/skills；团队共享，会随项目提交。',
          },
        ],
      }),
    ) as Scope;

    if (scope === 'project') {
      clack.note(projectScopeNotice(availablePacks, projectRoot), '项目级安装 · 二次确认');
      const ok = answer<boolean>(
        await clack.confirm({ message: '继续？', initialValue: false }),
      );
      if (!ok) cancelled('未确认，已取消，未写入任何文件。');
      accepted = true;
    }

    if (availablePacks.length > 0) {
      const chosen = answer<string[]>(
        await clack.multiselect<string>({
          message: '安装哪些技能包？',
          initialValues: availablePacks.map((pack) => pack.name),
          options: availablePacks.map((pack) => ({
            value: pack.name,
            label: `${pack.name} v${pack.version}`,
            hint: pack.description,
          })),
        }),
      );
      only = chosen;
      skipSkills = chosen.length === 0;
    }

    claude = answer<boolean>(
      await clack.confirm({
        message: '同时初始化 .claude/（Claude Code）？默认只装 .agents/',
        initialValue: flags.claude,
      }),
    );
  }

  if (scope === 'project' && !accepted) {
    process.stderr.write(`${red('拒绝')}：项目级安装需要显式确认第三方许可。\n`);
    process.stderr.write('  交互式：去掉 --yes，按提示确认\n');
    process.stderr.write('  非交互：追加 --accept-mpl-notice\n');
    process.stderr.write('  默认的用户级安装不写入任何仓库，不需要该确认\n');
    process.stderr.write('  详细文件清单：运行 agentscaffold --license\n');
    process.stderr.write('  agent / 合规扫描：agentscaffold --license --json\n');
    return 2;
  }

  const plan: InitPlan = buildInitPlan({
    projectRoot,
    scope,
    claude,
    force: flags.force,
    only,
    skipSkills,
    toolVersion,
  });

  const entries = allEntries(plan);
  const paths = scopePaths(scope, projectRoot);
  const glyphs = getGlyphs();

  if (tty) {
    clack.note(
      [
        `作用域    ${bold(scope === 'user' ? '用户级（推荐）' : '项目级')}`,
        `锚点      ${scope === 'user' ? '~' : paths.root}`,
        `技能包    ${plan.packs.length === 0 ? '（无）' : plan.packs.map((pack) => pack.name).join(', ')}`,
        `目录      ${['.agents', ...(claude ? ['.claude'] : [])].join(' + ')}`,
        `写入条目  ${entries.length}${flags.dryRun ? dim('（dry-run，不落盘）') : ''}`,
      ].join('\n'),
      '即将执行',
    );
  }

  if (entries.length === 0) {
    process.stdout.write(`${yellow('！')} 没有任何可写入的内容。\n`);
    return 0;
  }

  const progress = createProgress(entries.length);
  const result = applyPlan(plan, {
    force: flags.force,
    dryRun: flags.dryRun,
    onProgress: (path) => progress.tick(path),
  });
  progress.finish();

  const report: string[] = [];
  if (!tty) {
    report.push(`${bold('agentscaffold')} ${flags.dryRun ? '(dry-run) ' : ''}scope=${scope}`);
  }
  for (const record of result.records) {
    const label = OUTCOME_LABEL[record.outcome](record.outcome);
    const display = entries.find((item) => item.relativePath === record.relativePath)?.displayPath ?? record.relativePath;
    report.push(`  ${glyphs.phaseDone} ${display} ${dim(`[${label}]`)}`);
  }
  if (result.records.some((record) => record.outcome === 'skipped' || record.outcome === 'skipped-tree')) {
    report.push(`  ${glyphs.info} ${dim('已有文件被保留；用 --force 覆盖')}`);
  }
  process.stdout.write(`${report.join('\n')}\n`);

  const tools = probePacks(plan.packs);
  if (tools.length > 0) {
    const toolLines: string[] = ['', bold('技能所需 CLI')];
    for (const status of tools) {
      toolLines.push(`  ${formatToolLine(status)}`);
      toolLines.push(...formatToolDetails(status));
    }
    process.stdout.write(`${toolLines.join('\n')}\n`);
  }

  // Completion copy — scope-specific, one licence pointer, never the full wall.
  const dirs = scope === 'user' ? ['~/.agents/skills', ...(claude ? ['~/.claude/skills'] : [])] : ['./.agents/skills', ...(claude ? ['./.claude/skills'] : [])];
  const done =
    scope === 'user'
      ? [
          '',
          `已安装到用户级：${dirs.join('、')}`,
          '不会进入你的项目仓库。运行 `agentscaffold --license` 查看第三方许可。',
        ]
      : [
          '',
          `已安装到项目级：${dirs.join('、')}`,
          '请保留随附的 LICENSE/THIRD_PARTY_NOTICES。',
          '项目其他代码不受 MPL 影响。提交前请确认团队合规。',
        ];
  process.stdout.write(`${done.join('\n')}\n`);

  if (tty) {
    clack.outro(
      scope === 'user'
        ? `${green('完成')} — ${cyan('~/.agents/skills')}${flags.dryRun ? dim('（dry-run，未落盘）') : ''}`
        : `${green('完成')} — ${cyan('./.agents/skills')}${flags.dryRun ? dim('（dry-run，未落盘）') : ''}`,
    );
  }
  return 0;
}

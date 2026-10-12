import { join, resolve } from 'node:path';
import { exists, isDirectory, walkFiles } from '../util/fsx.js';
import { loadPacks, type LoadedPack } from '../pack/pack.js';
import { scopePaths, type Scope } from '../init/scope.js';
import { formatToolDetails, formatToolLine, probePacks } from '../init/cli-deps.js';
import { getGlyphs } from '../ui/glyphs.js';
import { bold, dim, yellow } from '../ui/color.js';
import { toolVersion } from '../util/version.js';
import { buildInfo } from '../util/build.js';

export interface DoctorFlags {
  scope?: string;
  json?: boolean;
}

interface ScopeState {
  scope: Scope;
  root: string;
  agentsDoc: string;
  claudeDoc: string;
  agentsSkills: string[];
  claudeSkills: string[];
  agentsDocPresent: boolean;
  claudeDocPresent: boolean;
  thirdPartyFiles: number;
}

function inspectScope(scope: Scope, projectRoot: string): ScopeState {
  const paths = scopePaths(scope, projectRoot);
  const listSkills = (dir: string): string[] => {
    try {
      return walkFiles(dir)
        .filter((file) => file.endsWith('/SKILL.md') || file === 'SKILL.md')
        .map((file) => file.split('/').slice(-2)[0] ?? file)
        .filter((name, index, all) => all.indexOf(name) === index)
        .sort();
    } catch {
      return [];
    }
  };
  const skillRoot = join(paths.agentsDir, 'skills');
  const claudeSkillRoot = join(paths.claudeDir, 'skills');
  const thirdParty = isDirectory(skillRoot)
    ? walkFiles(skillRoot).filter((file) => file.endsWith('THIRD-PARTY-NOTICES.md')).length
    : 0;
  return {
    scope,
    root: paths.root,
    agentsDoc: paths.agentsDoc,
    claudeDoc: paths.claudeDoc,
    agentsSkills: listSkills(skillRoot),
    claudeSkills: listSkills(claudeSkillRoot),
    agentsDocPresent: exists(paths.agentsDoc),
    claudeDocPresent: exists(paths.claudeDoc),
    thirdPartyFiles: thirdParty,
  };
}

function renderScope(state: ScopeState, packs: LoadedPack[]): string[] {
  const glyphs = getGlyphs();
  const where = state.scope === 'user' ? '~' : '.';
  const lines: string[] = [bold(`${state.scope === 'user' ? '用户级' : '项目级'}（${where}）`)];
  lines.push(
    `  ${state.agentsDocPresent ? glyphs.ok : glyphs.skip} ${state.agentsDoc.replace(process.env.HOME ?? '', '~')} ${
      state.agentsDocPresent ? '' : dim('（未初始化）')
    }`,
  );
  lines.push(
    `  ${state.agentsSkills.length > 0 ? glyphs.ok : glyphs.skip} .agents/skills — ${
      state.agentsSkills.length === 0 ? dim('无技能') : state.agentsSkills.join(', ')
    }`,
  );
  lines.push(
    `  ${state.claudeDocPresent || state.claudeSkills.length > 0 ? glyphs.ok : glyphs.skip} .claude — ${
      state.claudeSkills.length === 0
        ? state.claudeDocPresent
          ? 'CLAUDE.md 存在（无技能）'
          : dim('未初始化')
        : state.claudeSkills.join(', ')
    }`,
  );
  if (state.thirdPartyFiles > 0) {
    lines.push(`  ${glyphs.info} 随技能安装的第三方声明 ${state.thirdPartyFiles} 份`);
  }
  const declared = packs.flatMap((pack) => pack.skills.map((skill) => skill.name));
  const missing = declared.filter((name) => !state.agentsSkills.includes(name) && !state.claudeSkills.includes(name));
  if (missing.length > 0) {
    lines.push(`  ${yellow(glyphs.warn)} 未安装的技能：${missing.join(', ')}（agentscaffold init 安装）`);
  }
  return lines;
}

export function runDoctor(pathArg: string | undefined, flags: DoctorFlags): number {
  const projectRoot = resolve(pathArg ?? process.cwd());
  const packs = loadPacks();
  const scope: Scope = flags.scope === 'project' ? 'project' : flags.scope === 'user' ? 'user' : 'user';
  const states =
    flags.scope === undefined
      ? [inspectScope('user', projectRoot), inspectScope('project', projectRoot)]
      : [inspectScope(scope, projectRoot)];

  const info = buildInfo();
  if (flags.json === true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          projectRoot,
          packs: packs.map((pack) => pack.name),
          build: info,
          scopes: states,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines: string[] = [bold('agentscaffold doctor'), dim(projectRoot), ''];
  lines.push(`运行中的构建  ${info.runningFile}`);
  lines.push(`              ${dim(`构建于 ${info.builtAt}（v${toolVersion}）`)}`);
  if (info.stale) {
    lines.push(`  ${yellow('注意')}：源码比构建新（最新：${info.newestSource} ${info.newestSourceAt}），先跑 npm run build`);
  }
  lines.push('');
  for (const state of states) {
    lines.push(...renderScope(state, packs), '');
  }
  const tools = probePacks(packs);
  if (tools.length > 0) {
    lines.push(bold('技能所需 CLI'));
    for (const status of tools) {
      lines.push(`  ${formatToolLine(status)}`);
      lines.push(...formatToolDetails(status));
    }
    lines.push('');
  }
  lines.push(dim('完整许可：agentscaffold --license'));
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

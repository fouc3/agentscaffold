import { join } from 'node:path';
import { exists, isDirectory } from '../util/fsx.js';
import { loadPacks, packSkillRoot, selectAddOnPacks, selectPacks, type LoadedPack, type PackSkill } from '../pack/pack.js';
import { agentsMd, claudeImportPath, claudeMd, skillsReadme } from './templates.js';
import { displayPath, relativePath, scopePaths, type Scope, type ScopePaths } from './scope.js';

export type EntryKind = 'template' | 'copy-file' | 'copy-dir';

/** What actually happened to an entry, or what would happen under --dry-run. */
export type EntryOutcome =
  | 'created'
  | 'unchanged'
  | 'overwritten'
  | 'skipped'
  | 'skipped-tree'
  | 'partial';

export interface PlannedEntry {
  kind: EntryKind;
  absolutePath: string;
  /** Path relative to the scope root, POSIX-style. */
  relativePath: string;
  /** `~/.agents/skills/x` or `./AGENTS.md`, for reports. */
  displayPath: string;
  origin: string;
  /** True for license-bearing third-party material. */
  thirdParty: boolean;
  content?: string;
  source?: string;
  exists: boolean;
}

export interface InitOptions {
  projectRoot: string;
  scope: Scope;
  claude: boolean;
  force: boolean;
  only: string[] | undefined;
  /** Add-on (`optional: true`) packs to install on top of the defaults. */
  addPacks: string[] | undefined;
  skipSkills: boolean;
  toolVersion: string;
  now?: Date;
}

export interface InitPlan {
  projectRoot: string;
  scope: Scope;
  paths: ScopePaths;
  packs: LoadedPack[];
  skills: Array<{ pack: LoadedPack; skill: PackSkill }>;
  agents: PlannedEntry[];
  claude: PlannedEntry[];
}

export function buildInitPlan(options: InitOptions): InitPlan {
  const paths = scopePaths(options.scope, options.projectRoot);
  const all = loadPacks();
  const defaults = selectPacks(all, options.only);
  const addOns = selectAddOnPacks(all, options.addPacks, defaults);
  const packs = [...defaults, ...addOns];
  const skills: Array<{ pack: LoadedPack; skill: PackSkill }> = [];
  if (!options.skipSkills) {
    for (const pack of packs) {
      for (const skill of pack.skills) skills.push({ pack, skill });
    }
  }

  const entry = (
    absolutePath: string,
    init: Omit<PlannedEntry, 'absolutePath' | 'relativePath' | 'displayPath' | 'exists'>,
  ): PlannedEntry => ({
    ...init,
    absolutePath,
    relativePath: relativePath(absolutePath, paths),
    displayPath: displayPath(absolutePath, options.scope, options.projectRoot),
    exists: exists(absolutePath),
  });

  const user = options.scope === 'user';
  const context = {
    toolVersion: options.toolVersion,
    generatedAt: (options.now ?? new Date()).toISOString(),
    packs,
    projectName: user ? '本机全局（用户级）' : (options.projectRoot.split('/').pop() ?? options.projectRoot),
    claude: options.claude,
    scope: options.scope,
    skillsDir: user ? '~/.agents/skills/' : '.agents/skills/',
    claudeEntry: claudeImportPath(options.scope),
    claudeEntryNote: user
      ? 'Claude Code 通过 `~/.claude/CLAUDE.md` 里的 `@../.agents/AGENTS.md` 引用本文件；其它 harness 直接读取本文件。'
      : 'Claude Code 通过根目录 `CLAUDE.md` 里的 `@AGENTS.md` 引用本文件；其它 harness 直接读取本文件。',
  };

  const agents: PlannedEntry[] = [
    entry(paths.agentsDoc, {
      kind: 'template',
      origin: 'template:AGENTS.md',
      thirdParty: false,
      content: agentsMd(context),
    }),
    entry(join(paths.agentsDir, 'skills', 'README.md'), {
      kind: 'template',
      origin: 'template:skills-README',
      thirdParty: false,
      content: skillsReadme(packs),
    }),
  ];

  for (const { pack, skill } of skills) {
    const skillDir = join(paths.agentsDir, 'skills', skill.name);
    agents.push(
      entry(skillDir, {
        kind: 'copy-dir',
        origin: `pack:${pack.name}`,
        thirdParty: false,
        source: packSkillRoot(pack, skill),
      }),
      ...noticeEntries(entry, skillDir, pack),
    );
  }

  const claude: PlannedEntry[] = [];
  if (options.claude) {
    claude.push(
      entry(paths.claudeDoc, {
        kind: 'template',
        origin: 'template:CLAUDE.md',
        thirdParty: false,
        content: claudeMd(context),
      }),
      entry(join(paths.claudeDir, 'skills', 'README.md'), {
        kind: 'template',
        origin: 'template:claude-skills-README',
        thirdParty: false,
        content: skillsReadme(packs),
      }),
    );
    for (const { pack, skill } of skills) {
      const skillDir = join(paths.claudeDir, 'skills', skill.name);
      claude.push(
        entry(skillDir, {
          kind: 'copy-dir',
          origin: `pack:${pack.name}`,
          thirdParty: false,
          source: packSkillRoot(pack, skill),
        }),
        ...noticeEntries(entry, skillDir, pack),
      );
    }
  }

  return { projectRoot: options.projectRoot, scope: options.scope, paths, packs, skills, agents, claude };
}

/**
 * License material always travels *next to* the skill directory it covers — never only
 * at the scope root — so copying a single skill out of the tree keeps its notices.
 */
function noticeEntries(
  entry: (
    absolutePath: string,
    init: Omit<PlannedEntry, 'absolutePath' | 'relativePath' | 'displayPath' | 'exists'>,
  ) => PlannedEntry,
  skillDir: string,
  pack: LoadedPack,
): PlannedEntry[] {
  const out: PlannedEntry[] = [];

  // The verbatim upstream tree travels with the skill so the notices above stay true
  // even when the skill directory is copied out of the project on its own.
  const upstreamRoot = join(pack.root, 'upstream');
  if (isDirectory(upstreamRoot)) {
    out.push(
      entry(join(skillDir, 'upstream'), {
        kind: 'copy-dir',
        origin: `pack:${pack.name}:upstream`,
        thirdParty: true,
        source: upstreamRoot,
      }),
    );
  }

  // MIT also asks for the notice to travel with copies, so every pack ships its own.
  const notices: Array<{ file: string; thirdParty: boolean }> = [
    { file: 'LICENSE-MPL-2.0', thirdParty: true },
    { file: 'THIRD-PARTY-NOTICES.md', thirdParty: true },
    { file: 'TRADEMARKS.md', thirdParty: true },
    { file: 'LICENSE-MIT', thirdParty: false },
  ];
  for (const { file, thirdParty } of notices) {
    const source = join(pack.root, file);
    if (!exists(source)) continue;
    out.push(
      entry(join(skillDir, file), {
        kind: 'copy-file',
        origin: `pack:${pack.name}:notice`,
        thirdParty,
        source,
      }),
    );
  }
  return out;
}

export function allEntries(plan: InitPlan): PlannedEntry[] {
  return [...plan.agents, ...plan.claude];
}

export function countThirdParty(plan: InitPlan): number {
  return allEntries(plan).filter((item) => item.thirdParty).length;
}

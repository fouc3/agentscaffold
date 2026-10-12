import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

export type Scope = 'user' | 'project';

export interface ScopePaths {
  scope: Scope;
  /** Directory the scope is anchored at: the home directory, or the project root. */
  root: string;
  agentsDir: string;
  claudeDir: string;
  /**
   * The dev-requirements doc. User scope deliberately writes it inside `~/.agents/`
   * instead of the home directory itself, so `init` never drops a stray AGENTS.md
   * next to someone's dotfiles. Project scope puts it where agents look for it:
   * the repository root.
   */
  agentsDoc: string;
  claudeDoc: string;
}

export function scopePaths(scope: Scope, projectRoot: string): ScopePaths {
  if (scope === 'user') {
    const home = homedir();
    return {
      scope,
      root: home,
      agentsDir: join(home, '.agents'),
      claudeDir: join(home, '.claude'),
      agentsDoc: join(home, '.agents', 'AGENTS.md'),
      claudeDoc: join(home, '.claude', 'CLAUDE.md'),
    };
  }
  return {
    scope,
    root: projectRoot,
    agentsDir: join(projectRoot, '.agents'),
    claudeDir: join(projectRoot, '.claude'),
    agentsDoc: join(projectRoot, 'AGENTS.md'),
    claudeDoc: join(projectRoot, 'CLAUDE.md'),
  };
}

/** `~/.agents/skills/x` for user scope, `./.agents/skills/x` for project scope. */
export function displayPath(absolutePath: string, scope: Scope, projectRoot: string): string {
  if (scope === 'user') {
    const home = homedir();
    return absolutePath.startsWith(home) ? `~${absolutePath.slice(home.length)}` : absolutePath;
  }
  return absolutePath.startsWith(projectRoot) ? `.${absolutePath.slice(projectRoot.length)}` : absolutePath;
}

export function relativePath(absolutePath: string, paths: ScopePaths): string {
  return relative(paths.root, absolutePath).split(sep).join('/');
}

export function scopeLabel(scope: Scope): string {
  return scope === 'user' ? 'user — 本机所有项目' : 'project — 仅当前仓库';
}

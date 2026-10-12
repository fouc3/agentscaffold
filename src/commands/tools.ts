/**
 * `agentscaffold tools` — inspect and undo the optional tools we installed.
 *
 * They live in one private prefix (`~/.agents/tools`), so "what did it leave behind" has a short
 * answer and "undo" is one command. Nothing here ever touches the system global prefix.
 */
import { existsSync } from 'node:fs';
import { bold, dim, green, red, yellow } from '../ui/color.js';
import { loadPacks } from '../pack/pack.js';
import { probePacks } from '../init/cli-deps.js';
import {
  advisoryOnly,
  installableMissing,
  isolatedArgv,
  listInstalled,
  pathHint,
  prefixStateNote,
  removeAll,
  removeTool,
  toolsDir,
} from '../init/tool-install.js';

export interface ToolsFlags {
  remove?: string;
  removeAll: boolean;
  json: boolean;
}

export async function runTools(flags: ToolsFlags): Promise<number> {
  const dir = toolsDir();
  const installed = listInstalled(dir);
  const hint = pathHint(dir);

  if (flags.removeAll) {
    if (!existsSync(dir)) {
      process.stdout.write(`${dim(`${dir} 不存在，没有要撤销的。`)}\n`);
      return 0;
    }
    const before = installed.length;
    await removeAll(dir);
    process.stdout.write(`${green('已撤销')}：移除 ${before} 个工具与整个 ${dir}\n`);
    return 0;
  }

  if (flags.remove !== undefined) {
    const outcome = await removeTool(flags.remove, dir);
    if (!outcome.ok) {
      process.stderr.write(`${red('错误')}：${flags.remove} ${outcome.detail}\n`);
      return 1;
    }
    process.stdout.write(`${green('已移除')} ${flags.remove}\n`);
    return 0;
  }

  const statuses = probePacks(loadPacks());
  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          tool: 'agentscaffold',
          prefix: dir,
          bin: hint.binDir,
          on_path: hint.onPath,
          path_line: hint.line,
          installed,
          missing_installable: installableMissing(statuses).map((status) => ({
            name: status.name,
            manager: status.installWith?.manager,
            package: status.installWith?.package,
            command: isolatedArgv({
              name: status.name,
              manager: status.installWith?.manager ?? 'npm',
              package: status.installWith?.package ?? '',
            }, dir),
          })),
          missing_advisory_only: advisoryOnly(statuses).map((status) => ({
            name: status.name,
            install: status.install,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write(`${bold('可选工具')}\n`);
  process.stdout.write(`  自用前缀  ${dir}\n`);
  process.stdout.write(`  bin       ${hint.binDir}${hint.onPath ? dim('（已在 PATH 上）') : yellow('（不在 PATH 上）')}\n`);
  if (!hint.onPath) process.stdout.write(`  加进 PATH：${hint.line}\n`);

  if (installed.length === 0) {
    process.stdout.write(`  ${dim('（还没装过任何工具）')}\n`);
  } else {
    process.stdout.write(`${bold('  已装')}\n`);
    for (const record of installed) {
      process.stdout.write(
        `    ${record.name} ${dim(`[${record.manager}] ${record.package} · ${record.installedAt.slice(0, 19)}`)}\n`,
      );
    }
  }

  const missing = installableMissing(statuses);
  if (missing.length > 0) {
    process.stdout.write(`${bold('  可以代装（进自用前缀，不动系统）')}\n`);
    for (const status of missing) {
      const command = isolatedArgv({
        name: status.name,
        manager: status.installWith?.manager ?? 'npm',
        package: status.installWith?.package ?? '',
      }, dir);
      process.stdout.write(`    ${status.name}：${dim(command.join(' '))}\n`);
    }
  }
  const advice = advisoryOnly(statuses);
  if (advice.length > 0) {
    process.stdout.write(`${bold('  只给建议（装法因环境而异）')}\n`);
    for (const status of advice) process.stdout.write(`    ${status.name}：${dim(status.install ?? '见技能说明')}\n`);
  }
  process.stdout.write(`${dim(`  撤销：agentscaffold tools --remove <名字> / --remove-all（当前：${prefixStateNote(dir)}）`)}\n`);
  return 0;
}

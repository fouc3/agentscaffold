#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from '../commands/init.js';
import { runUninstall } from '../commands/uninstall.js';
import { runLicense } from '../commands/license.js';
import { runDoctor } from '../commands/doctor.js';
import { loadPacks } from '../pack/pack.js';
import { buildLicenseReport, helpLicenseBlock } from '../license/notice.js';
import { toolVersion } from '../util/version.js';
import { bold, dim, red } from '../ui/color.js';

const argv = process.argv.slice(2);

/**
 * `--license` (and `--license --json`) must work with no subcommand and must not fall
 * into commander's "missing command" path, so it is intercepted before parsing.
 */
if (argv.includes('--license')) {
  process.exitCode = runLicense({ json: argv.includes('--json') });
} else {
  const packs = loadPacks();
  const program = new Command();

  program
    .name('agentscaffold')
    .description('为项目或用户初始化 agent 技能、开发要求文档与所需 CLI')
    .version(toolVersion, '-v, --version')
    .option('--license', '打印完整许可、MPL 文件清单、源码链接与商标声明')
    .option('--json', '配合 --license 使用，输出机器可读 JSON')
    .showHelpAfterError()
    .addHelpText('after', `\n${helpLicenseBlock(buildLicenseReport(packs, toolVersion))}\n`);

  program
    .command('init')
    .description('初始化技能与开发要求文档（默认只写 .agents/）')
    .argument('[path]', '项目根目录', process.cwd())
    .option('--scope <scope>', 'user（默认，推荐）或 project')
    .option('--yes', '不交互，全部使用默认值/参数', false)
    .option('--force', '覆盖已存在的文件', false)
    .option('--dry-run', '只预览计划，不写盘', false)
    .option('--claude', '同时初始化 .claude/（默认只初始化 .agents/）', false)
    .option('--skills <names>', '逗号分隔的技能包名（默认全部）')
    .option('--no-skills', '只写文档，不安装技能包')
    .option('--accept-mpl-notice', '非交互模式下确认接受第三方许可（项目级安装必需）', false)
    .option('--commit', '项目级：完成后把本次改动提交到当前仓库（非交互模式需显式指定；不会 push）', false)
    .action(async (path: string, options: Record<string, unknown>) => {
      const skillsOption = options.skills;
      process.exitCode = await runInit(path, {
        scope: typeof options.scope === 'string' ? options.scope : undefined,
        yes: options.yes === true,
        force: options.force === true,
        dryRun: options.dryRun === true,
        claude: options.claude === true,
        skills:
          typeof skillsOption === 'string'
            ? skillsOption
                .split(',')
                .map((name) => name.trim())
                .filter((name) => name.length > 0)
            : undefined,
        noSkills: skillsOption === false,
        acceptMplNotice: options.acceptMplNotice === true,
        commit: options.commit === true,
      });
    });

  program
    .command('uninstall')
    .description('移除 agentscaffold 安装的文件（自动探测用户级/项目级，有哪个显示哪个）')
    .argument('[path]', '项目根目录', process.cwd())
    .option('--scope <scope>', '只卸载某个作用域：user 或 project')
    .option('--yes', '不交互，直接执行', false)
    .option('--force', '连安装后被修改过的文件也删除', false)
    .option('--dry-run', '只预览要删什么，不落盘', false)
    .option('--commit', '项目级：卸载后把本次改动提交到当前仓库（非交互模式需显式指定；不会 push）', false)
    .action(async (path: string, options: Record<string, unknown>) => {
      process.exitCode = await runUninstall(path, {
        scope: typeof options.scope === 'string' ? options.scope : undefined,
        yes: options.yes === true,
        force: options.force === true,
        dryRun: options.dryRun === true,
        commit: options.commit === true,
      });
    });

  program
    .command('license')
    .description('打印完整许可信息（等价于 --license）')
    .option('--json', '输出 JSON', false)
    .action((options: Record<string, unknown>) => {
      process.exitCode = runLicense({ json: options.json === true });
    });

  program
    .command('doctor')
    .description('检查当前机器/项目的初始化状态与所需 CLI')
    .argument('[path]', '项目根目录', process.cwd())
    .option('--scope <scope>', '只看某个作用域：user 或 project')
    .option('--json', '输出 JSON', false)
    .action((path: string, options: Record<string, unknown>) => {
      process.exitCode = runDoctor(path, {
        scope: typeof options.scope === 'string' ? options.scope : undefined,
        json: options.json === true,
      });
    });

  program
    .command('packs')
    .description('列出随包技能包')
    .action(() => {
      if (packs.length === 0) {
        process.stdout.write('（没有随包技能包）\n');
        return;
      }
      process.stdout.write(`${bold('随包技能包')}\n`);
      for (const pack of packs) {
        process.stdout.write(
          `  ${pack.name} v${pack.version} ${dim(`[${pack.license}]`)} — ${pack.description}\n`,
        );
      }
    });

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    process.stderr.write(`${red('错误')}：${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

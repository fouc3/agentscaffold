#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from '../commands/init.js';
import { runUninstall } from '../commands/uninstall.js';
import { runLicense } from '../commands/license.js';
import { runDoctor } from '../commands/doctor.js';
import { loadPacks } from '../pack/pack.js';
import { runSearch, runSearchTui } from '../commands/search.js';
import { runContext } from '../commands/context.js';
import { runTools } from '../commands/tools.js';
import { interactive } from '../ui/prompt.js';
import { buildLicenseReport, helpLicenseBlock } from '../license/notice.js';
import { toolVersion } from '../util/version.js';
import { bold, dim, green, red, yellow } from '../ui/color.js';

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
    .option('--license', '打印完整许可、MPL 文件清单、源码链接与商标声明（加 --json 输出机器可读 JSON）')
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
    .option('--skills <names>', '逗号分隔的技能包名（默认全部非附加包）')
    .option('--add-packs <names>', '逗号分隔的附加技能包名（默认一个都不装）')
    .option('--no-skills', '只写文档，不安装技能包')
    .option('--accept-mpl-notice', '非交互模式下确认接受第三方许可（项目级安装必需）', false)
    .option('--commit', '项目级：完成后把本次改动提交到当前仓库（非交互模式需显式指定；不会 push）', false)
    .option('--install-tools', '安装缺失的可选工具（只装各技能包声明了安装命令的；非交互模式需显式指定）', false)
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
        addPacks:
          typeof options.addPacks === 'string'
            ? options.addPacks
                .split(',')
                .map((name) => name.trim())
                .filter((name) => name.length > 0)
            : undefined,
        acceptMplNotice: options.acceptMplNotice === true,
        commit: options.commit === true,
        installTools: options.installTools === true,
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
        const kind = pack.optional === true ? yellow('[附加，默认不装]') : green('[默认安装]');
        process.stdout.write(
          `  ${pack.name} v${pack.version} ${dim(`[${pack.license}]`)} ${kind} — ${pack.description}\n`,
        );
      }
    });

  program
    .command('search')
    .description('检索：本地代码检索（定义/标识符/文本/调用关系），不带参数运行本程序会进入检索 TUI')
    .argument('[query]', '要检索的符号名或文本')
    .option('--kind <kind>', 'define（定义/实现）、id（标识符）、text（文本，默认）、callers、callees、impact')
    .option('--path <dir>', '项目目录（默认当前目录）')
    .option('--glob <pattern>', '文本检索的路径限制，例如 src/** 或 **/*.ts')
    .option('--ext <exts>', '文本检索的扩展名限制，逗号分隔，例如 ts,css')
    .option('--limit <n>', '最多多少条结果', '30')
    .option('--json', '输出 JSON', false)
    .action(async (query: string | undefined, options: Record<string, unknown>) => {
      const path = typeof options.path === 'string' ? options.path : undefined;
      // A human at the keyboard with nothing to search: open the TUI instead of nagging.
      if (interactive() && path === undefined && (query === undefined || query.length === 0)) {
        process.exitCode = await runSearchTui();
        return;
      }
      process.exitCode = await runSearch({
        path,
        query: typeof options.query === 'string' ? options.query : query,
        kind: typeof options.kind === 'string' ? options.kind : undefined,
        glob: typeof options.glob === 'string' ? options.glob : undefined,
        ext: typeof options.ext === 'string' ? options.ext : undefined,
        json: options.json === true,
        limit: Number.parseInt(String(options.limit ?? '30'), 10) || 30,
      });
    });

  program
    .command('context')
    .description('按改动的文件机械决定该读哪些文档/技能（Firefox review-context.toml 的本地重写：JSON + 本地评估）')
    .argument('[path]', '项目根目录', process.cwd())
    .option('--changed <files...>', '手动指定改动文件')
    .option('--since <ref>', '用 git diff <ref> 取改动文件（工作区 vs 该 ref）')
    .option('--range <a...b>', '用 PR 式的三点比较，例如 main...HEAD')
    .option('--rules <path>', '规则文件路径（默认 <项目>/.agents/context-rules.json）')
    .option('--check', '只校验规则文件', false)
    .option('--list', '列出规则', false)
    .option('--init', '生成规则文件模板', false)
    .option('--json', '输出 JSON', false)
    .action((path: string, options: Record<string, unknown>) => {
      process.exitCode = runContext(path, {
        changed: Array.isArray(options.changed) ? (options.changed as string[]) : [],
        since: typeof options.since === 'string' ? options.since : undefined,
        range: typeof options.range === 'string' ? options.range : undefined,
        rules: typeof options.rules === 'string' ? options.rules : undefined,
        check: options.check === true,
        list: options.list === true,
        init: options.init === true,
        json: options.json === true,
      });
    });

  program
    .command('tools')
    .description('查看/撤销我们代装的可选工具（装在 ~/.agents/tools，从不碰系统全局）')
    .option('--remove <name>', '撤销某一个工具')
    .option('--remove-all', '撤销全部并删除自用前缀目录', false)
    .option('--json', '输出 JSON', false)
    .action(async (options: Record<string, unknown>) => {
      process.exitCode = await runTools({
        remove: typeof options.remove === 'string' ? options.remove : undefined,
        removeAll: options.removeAll === true,
        json: options.json === true,
      });
    });

  try {
    if (argv.length === 0) {
      // Bare invocation: a human gets the 检索 TUI; a pipe/agent/bash gets help, because
      // prompting where nothing can answer would just look like a hang.
      if (interactive()) {
        process.exitCode = await runSearchTui();
      } else {
        program.outputHelp();
      }
    } else {
      await program.parseAsync(process.argv);
    }
  } catch (error) {
    process.stderr.write(`${red('错误')}：${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

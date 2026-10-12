import type { LoadedPack } from '../pack/pack.js';
import type { Scope } from './scope.js';

export interface TemplateContext {
  toolVersion: string;
  generatedAt: string;
  packs: LoadedPack[];
  projectName: string;
  claude: boolean;
  scope: Scope;
  /** Where the skills land, as written in the generated docs. */
  skillsDir: string;
  /** The concrete `@`-import line that makes CLAUDE.md point at AGENTS.md. */
  claudeEntry: string;
  /** Prose describing how the two docs relate in this scope. */
  claudeEntryNote: string;
}

export const AGENTS_MARKER = '<!-- agentscaffold:begin -->';
export const AGENTS_MARKER_END = '<!-- agentscaffold:end -->';

/** The import has to be relative to CLAUDE.md's own directory, so it differs per scope. */
export function claudeImportPath(scope: Scope): string {
  return scope === 'user' ? '@../.agents/AGENTS.md' : '@AGENTS.md';
}

export function claudeMd(context: TemplateContext): string {
  const user = context.scope === 'user';
  const agentsDoc = user ? '~/.agents/AGENTS.md' : 'AGENTS.md';
  const skills = user ? '~/.claude/skills' : '.claude/skills';
  const agentsSkills = user ? '~/.agents/skills' : '.agents/skills';

  return `# CLAUDE.md${user ? '（用户级）' : ''}

本${user ? '机' : '仓库'}对 AI agent 的权威约定在 ${agentsDoc}，本文件只是 Claude Code 的入口。

${context.claudeEntry}

## Claude Code 专属说明

- 需要修改约定时改 \`${agentsDoc}\`，不要改这个包装文件；重新运行 \`agentscaffold init --claude\` 只会重写本文件。
- 技能位于 \`${skills}/<name>/SKILL.md\`。同一份技能同时装在 \`${agentsSkills}/\`：Claude Code 读前者，Codex / DSH 等读后者。**不需要**再单独生成 \`.dsh/skills/\` —— DSH 会直接读 \`.agents/skills/\`。
- Claude Code 支持 \`@\` 递归导入（例如 \`@docs/AGENTS.md\`，路径相对本文件所在目录解析）；其它 harness 会自动加载就近的 \`AGENTS.md\`，所以子目录需要额外约定时，在该目录放一个 \`AGENTS.md\` 即可。
`;
}

export function skillsReadme(packs: LoadedPack[]): string {
  const lines: string[] = [];
  lines.push('# 技能目录（agent skills）');
  lines.push('');
  lines.push('每个子目录是一个技能，入口固定为 `SKILL.md`（带 `name` 与 `description` 的 YAML frontmatter），');
  lines.push('技能需要的脚本、参考文档、样例都放在同一个子目录里。');
  lines.push('');
  lines.push('## 本目录当前包含');
  lines.push('');
  if (packs.length === 0) {
    lines.push('- （空）');
  } else {
    for (const pack of packs) {
      for (const skill of pack.skills) {
        lines.push(`- \`${skill.name}\` — 来自技能包 \`${pack.name}\` v${pack.version}（${pack.license}）：${pack.description}`);
      }
    }
  }
  lines.push('');
  lines.push('## 两条硬约束');
  lines.push('');
  lines.push('1. `description` 会在每次会话进入上下文，用来自动决定是否加载该技能。写得过宽会导致误触发，');
  lines.push('   过窄会导致该用的时候不加载——按「什么时候该用 + 什么时候不该用」两句话写。');
  lines.push('2. 技能正文按需读取：把长案例、长参考拆到 `references/`，主文件只写流程，并明确「到第几步才读哪个文件」。');
  lines.push('');
  lines.push('## 带 upstream/ 的技能');
  lines.push('');
  lines.push('`upstream/` 下是从其它项目提取的原始文件，保持原样并沿用其原许可证');
  lines.push('（见同目录 `LICENSE-*` 与 `THIRD-PARTY-NOTICES.md`；来源 commit 见 `upstream/PROVENANCE.json`）；');
  lines.push('我们自己的改写只体现在同级的 `SKILL.md` 与 `references/`。');
  return `${lines.join('\n')}\n`;
}

export function agentsMd(context: TemplateContext): string {
  const skillList =
    context.packs.length === 0
      ? '（本次未安装任何技能包）'
      : context.packs
          .flatMap((pack) => pack.skills.map((skill) => `\`${skill.name}\``))
          .join('、');

  const user = context.scope === 'user';

  return `# ${context.projectName} — 开发要求（AGENTS.md）

${AGENTS_MARKER}
> 本文件由 agentscaffold v${context.toolVersion} 生成于 ${context.generatedAt}，作用域：${user ? '用户级（本机所有项目）' : '项目级（本仓库）'}。
> 它是**本${user ? '机' : '仓库'}对 AI agent 的唯一权威约定**。${context.claudeEntryNote}
> 重新运行 \`agentscaffold init\` **不会**覆盖本文件（除非显式 \`--force\`），请在这里持续增删。
${AGENTS_MARKER_END}

## 1. 项目速览

<!-- TODO: 一句话说明这个项目是什么、给谁解决什么问题 -->

- 语言 / 运行时：
- 构建：
- 测试：
- 格式与静态检查：
- 问题跟踪：

## 2. 工具（先查工具，再动手）

不要盲目全仓搜索；先把这几条用上（工具本身不替我们做决定，只是省时间）：

| 想知道 | 用什么 |
| --- | --- |
| 某个符号定义/实现在哪（完整源码块，不是一行上下文） | \`agentscaffold search <符号> --kind define\` （需要项目已建代码索引） |
| 精确找标识符（而不是文本命中） | \`agentscaffold search <符号> --kind id\` （需要索引） |
| 谁调用了它 / 它调用了谁 / 改它影响谁 | \`agentscaffold search <符号> --kind callers\\|callees\\|impact\` （需要索引） |
| 纯文本搜索（可限路径与扩展名） | \`agentscaffold search '<文本>' --kind text --glob 'src/*'\` （无需索引） |
| 这次改动该读哪些文档/技能 | \`agentscaffold context --since HEAD\` （按 \`.agents/context-rules.json\` 机械判定） |

索引类查询在未建索引时会明确报错并给出该执行的命令，不会给你错误的答案——那就先用文本搜索，
或者按提示建索引。规则文件本身用 \`agentscaffold context --check\` 校验。

## 2. 常用命令

| 目的 | 命令 |
| --- | --- |
| 构建 | \`<!-- TODO -->\` |
| 跑全部测试 | \`<!-- TODO -->\` |
| 跑单个测试 | \`<!-- TODO -->\` |
| 格式 / lint | \`<!-- TODO -->\` |

约定：文档、注释、提交信息里引用命令时用**可直接复制执行**的完整形式。

## 3. 代码风格

- 注释克制：只在非显然处、公共 API、类定义上写；不要为了「看起来完整」堆注释。
- 不要删除与本次改动无关的既有注释。
- 与周围代码保持一致，不做与任务无关的格式化 / 重排 / 重命名。

## 4. 引用代码的规范

- **引用名字，不引用位置**：优先写清函数名、类名、配置项、flag 名；文件名可以不带到行号。
- 必须给位置时用 permalink（钉住具体 revision），不要用跟随主干的裸路径或裸行号——它们会随代码腐烂。
- 描述里避免「上面那个函数」这类相对位置说法。

## 5. 工作流

- 动手前先读相关文件，再改；不要凭印象改。
- 小步提交，一个提交表达一件事；提交信息说明**为什么**改。
- **未经批准不要 push、不要建 PR、不要改 upstream 分支**。
- 不顺手修无关问题：发现顺带的问题先报告，由人决定是否纳入本次改动。
- 慢命令（完整测试、构建）不要把输出用 \`head\`/\`tail\`/\`grep\` 管道起来——重定向到 \`artifacts/\` 下的文件再按需读，避免为了看不同片段反复重跑。

## 6. 验证要求

- 语法通过 ≠ 跑得对。以**行为对比**为准：同一批确定性输入下比对返回值/异常/产物。
- 失败先复现：能稳定复现再动手改；改完用同一条复现路径回验。
- 声称「通过」必须给出实际执行的命令与结果，不接受推测。

## 7. 性能回归

本${user ? '机' : '仓库'}已安装技能：${skillList}。

处理性能回归告警时按技能流程走，不要凭直觉直接开始优化：

- 技能入口：\`${context.skillsDir}perf-regression-triage/SKILL.md\`
- 数据源声明：\`.agents/perf-triage.config.json\`（项目根，按项目各自声明；不存在就先按技能的 \`references/adapters.md\` 建一个）
- 核心纪律：先确认回归是否真实复现，再定位成因；一次 CI 只回答一个问题；参考文档到对应步骤才读。

## 8. 禁止事项

- 提交密钥、token、真实用户数据。
- 未经批准改动 CI 配置、发布流程、迁移脚本。
- 为了让测试变绿而放宽断言、跳过测试或删除失败用例。

## 9. 本文件的维护

- 约定变更直接改本文件。
- 子目录有额外约定时，在该目录放一个同名 \`AGENTS.md\`（就近生效）。
`;
}

# 细节

[README.md](README.md) 是给人看的介绍，这里是参数、实现方式与测试情况。

## 完整参数

| 目的 | 命令 |
| --- | --- |
| 初始化（默认用户级，交互） | `agentscaffold init` |
| 只预览计划 | `agentscaffold init --dry-run` |
| 安装到当前仓库 | `agentscaffold init --scope project --accept-mpl-notice` |
| 同时装 Claude Code | `agentscaffold init --claude` |
| 只装部分技能包 | `agentscaffold init --skills perf-regression-triage` |
| 只写文档、不装技能 | `agentscaffold init --no-skills` |
| 覆盖已有文件 | `agentscaffold init --force` |
| 完成后提交本次改动（项目级） | `agentscaffold init --scope project --accept-mpl-notice --commit` |
| 卸载（自动探测作用域） | `agentscaffold uninstall` |
| 只卸载某一作用域 | `agentscaffold uninstall --scope user\|project` |
| 预览卸载 | `agentscaffold uninstall --dry-run` |
| 连改过的文件一起删 | `agentscaffold uninstall --force` |
| 卸载后提交本次改动 | `agentscaffold uninstall --commit` |
| 检查安装状态与 CLI | `agentscaffold doctor [path] [--scope user\|project] [--json]` |
| 列出随包技能包 | `agentscaffold packs` |
| 完整许可与 MPL 文件清单 | `agentscaffold --license` |
| 机器可读许可信息 | `agentscaffold --license --json` |

非交互规则：`--yes`、stdin/stdout 非 TTY、设置了 `CI` 时走纯文本输出
（覆盖：`AGENTSCAFFOLD_FORCE_TUI=1` 强制交互，`AGENTSCAFFOLD_NO_TUI=1` 强制非交互）。
`AGENTSCAFFOLD_ASCII=1` / `AGENTSCAFFOLD_UNICODE=1` 可强制 glyph 档位。

## 写入清单

| 作用域 | `init` | `--claude` |
| --- | --- | --- |
| user | `~/.agents/AGENTS.md`、`~/.agents/skills/README.md`、`~/.agents/skills/<skill>/…` | `~/.claude/CLAUDE.md`（导入 `@../.agents/AGENTS.md`）、`~/.claude/skills/<skill>/…` |
| project | `<root>/AGENTS.md`、`<root>/.agents/skills/README.md`、`<root>/.agents/skills/<skill>/…` | `<root>/CLAUDE.md`（导入 `@AGENTS.md`）、`<root>/.claude/skills/<skill>/…` |

- 不生成 `.dsh/skills/`：DSH 自己就会读 `<root>/.agents/skills/` 与 `~/.agents/skills/`。
- `CLAUDE.md` 的 `@` 导入必须相对它自身目录解析，所以用户级写 `@../.agents/AGENTS.md`、
  项目级写 `@AGENTS.md`（写成一样会指向不存在的位置）。
- 项目级确认默认是 No；非交互模式必须 `--accept-mpl-notice`，否则 exit 2 且不写任何文件。

## 安装清单与卸载判定

清单位置：

| 作用域 | 路径 |
| --- | --- |
| user | `~/.agents/agentscaffold.manifest.json` |
| project | `<root>/.agents/agentscaffold.manifest.json` |

清单逐条记录：相对路径、内容 sha256、来源（模板 / 技能包 / 通知文件）。
重复 `init` 时按路径合并旧条目，并保留首次 `installedAt`。

判定规则：

- **只记录"磁盘上与我们安装版本一致"的文件**，不把用户既有文件记进来。
- 卸载时逐条比对当前 sha256：相同 → 删除；不同 → 保留并在报告里标 `[kept: 安装后被修改]`，
  同时清单**只保留这些条目**，方便之后再 `--force` 收尾。
- 删除完自底向上清理被清空的目录（含 `.agents` 本身），非空目录与清单外文件一律不动。
- 两个作用域都没有清单 → 报错 exit 2，不做任何猜测性删除；双作用域 + 非交互 → 必须 `--scope`。

## 技能包格式

```
packs/<包名>/
  pack.json                      # name/version/description/license
                                 #   skills[]：技能名 + 目录
                                 #   cli[]：依赖的工具
                                 #   upstream[]（可选）：来源仓库/路径/固定提交/许可/文件清单
  skills/<技能名>/SKILL.md        # 技能入口：frontmatter 需含 name 与 description
  skills/<技能名>/references/     # 按需读取的长文档
  upstream/                      # 可选：原样保留的上游文件 + PROVENANCE.json
  LICENSE-* / THIRD-PARTY-NOTICES.md / TRADEMARKS.md
```

`cli[]` 每项字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 可执行文件名（用于探测） |
| `required` | 缺失是否导致技能不可用 |
| `why` | 为什么需要它（`doctor` 报告里显示） |
| `install` | 建议的安装命令（只显示，不执行） |
| `fallback` | 没有它时怎么办 |

两条写作约束：

1. `description` 会在每次会话进入上下文，按「什么时候该用 + 什么时候不该用」写清楚，
   过宽会误触发、过窄会该用时不加载。
2. 正文按需读取：长案例拆到 `references/`，主文件只写流程，并说明走到第几步才读哪一篇。

## 交互提示语的写法

约定见 [`src/ui/prompt.ts`](src/ui/prompt.ts) 顶部注释，四条：

1. 提示语就是那个决定本身：「是否 <动作>？」或「<动作>？」。
2. 不用第一人称（「要我…」这类写法不对）。
3. 理由或约束放句尾括号，例如「（只提交本次涉及的路径，不会 push）」。
4. 超过一行的话放上方的 `note` 块，并用 `wrapToWidth()` 预折行——clack 自己用
   `wrapAnsi({hard:true})` 硬折行，会在词中间断开。

## 许可细节

- 本工具自身：MIT（根 `LICENSE` 必须是**纯 MIT 正文**，追加任何说明都会让 GitHub 识别不出许可）。
- 技能文件**逐文件**判定，判据是 `pack.json` 的 `upstream.files` 清单：
  - 在 `upstream/` 且在清单里 → MPL-2.0，原样保留；
  - 在 `skills/<name>/` 且与清单同名 → MPL-2.0 衍生（改写不脱离 MPL）；
  - 其余 → MIT 原创。
- `LICENSE-MPL-2.0` / `THIRD-PARTY-NOTICES.md` / `TRADEMARKS.md` 随技能目录一起安装，
  不只在项目根。
- 生成的 `AGENTS.md` 是自写模板，不含任何 MPL 正文。
- 三种输出：`--help`（一行级短块）、`--license`（全文 + 文件清单 + 源码/提交链接 + 商标声明）、
  `--license --json`（`tool_license` / `mpl_files` / `project_license_impact:"none"` /
  `mpl_url` / `third_party_notices`）。
- 商标声明独立成段：MPL 不授予商标权，只能说「受 Firefox 工作流启发」，
  不能说「官方 Firefox 技能包」。

## 目录

```
packs/<pack>/        技能包：pack.json + skills/ + upstream/ + 通知文件
src/bin/             CLI 入口（commander）
src/commands/        init / uninstall / license / doctor
src/init/            作用域、计划、落盘、模板、安装清单、CLI 探测
src/license/         许可报告（human / json / --help 短文案）
src/pack/            技能包清单加载
src/ui/              glyph 回退、颜色、宽度与折行、clack 封装、进度条
src/util/            文件、git 代提交、版本
scripts/smoke.mjs    端到端冒烟（用假 HOME，不碰真实用户目录）
```

## 开发

```bash
npm install
npm run build     # tsc + chmod bin
npm run smoke     # 50 项端到端断言
```

冒烟覆盖（按主题）：

- **安装**：项目级未确认声明必须被拒绝且不落盘、`--claude` 才动 `.claude/`、重复运行幂等、
  `--dry-run` 不写盘、用户级不污染 HOME 根与 `AGENTS.md`、两种作用域下 `CLAUDE.md` 的
  `@` 导入必须解析到真实文件、`--skills` 过滤、`--license --json` 结构。
- **文档生成**：`AGENTS.md` 不得混入 MPL 内容。
- **终端渲染**：进度条帧宽在任何列宽下 ≤ `columns - 1`（超宽会折行，使 `\r` 失效、
  每帧新起一行，详见 `src/ui/progress.ts` 注释）；每帧以 CR 开头、帧内不得含 LF；
  note 文案按分句折行不丢字、行尾不留空格。
- **清单**：schema/scope/逐文件 sha256 正确，且不把用户既有文件记进去。
- **卸载**：清单内文件删净、空目录清理、清单外文件保留、无清单报错 exit 2、
  双作用域必须 `--scope`、`--dry-run` 不落盘、被改过的文件默认保留且清单只留这些条目。
- **代提交**：只提交本次路径（测试里故意先暂存一个无关文件，验证它不会进提交也不被清出暂存区）、
  非交互不加 `--commit` 不提交、用户级不触发提交步骤、未初始化仓库时不加 `--commit`
  绝不 `git init`、加了会先 `git init -b main` 再提交且无远程、缺 git 身份时给出可照做的
  `git config` 提示且不产生空提交。

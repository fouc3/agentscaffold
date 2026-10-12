# agentscaffold

给一个项目（或整台机器）一次把「agent 技能 + 开发要求文档 + 技能所需 CLI」装好。

一次 `init` 做三件事：

1. 把技能包装到 `.agents/skills/`（默认**只**动 `.agents/`；`.claude/` 需要 `--claude` 才装）
2. 写一份根目录开发要求文档 `AGENTS.md`（`CLAUDE.md` 只有一行 `@AGENTS.md`）
3. 报告技能所需的 CLI 缺哪些、怎么装、缺了怎么退（**不**替你执行安装）

TUI 走 `@clack/prompts`，与 `@colbymchenry/codegraph` 同一套交互组件与 glyph 回退策略
（Windows / `TERM=linux` 自动降级为 ASCII，`--help` 之外的提示不做 ASCII 菜单排版）。
`--yes` 或非 TTY 环境自动转为纯文本输出。

## 安装范围

推荐用户级安装：技能只对当前用户可用，不进入项目仓库，也不会把 MPL 文件带入项目。

```bash
agentscaffold init            # 默认：用户级 → ~/.agents/skills
agentscaffold init --claude   # 用户级 + ~/.claude/skills 与 ~/.claude/CLAUDE.md
```

项目级安装会把技能文件放入项目目录，适合团队共享：

```bash
agentscaffold init --scope project --accept-mpl-notice
```

交互式运行（不加 `--yes`）时，选择项目级会弹出二次确认；非交互运行必须显式加
`--accept-mpl-notice`，否则**拒绝执行且不写任何文件**。

其中标注 MPL-2.0 的文件仅这些文件受 MPL 约束，不影响项目其他代码。若随项目再分发，
请保留随附的 `LICENSE-MPL-2.0` / `THIRD-PARTY-NOTICES.md` / `TRADEMARKS.md`——
它们随技能目录一起安装，而不是只放在项目根。

## 常用命令

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

### 写入清单

| 作用域 | `init` | `--claude` |
| --- | --- | --- |
| user | `~/.agents/AGENTS.md`、`~/.agents/skills/README.md`、`~/.agents/skills/<skill>/…` | `~/.claude/CLAUDE.md`（导入 `@../.agents/AGENTS.md`）、`~/.claude/skills/<skill>/…` |
| project | `<root>/AGENTS.md`、`<root>/.agents/skills/README.md`、`<root>/.agents/skills/<skill>/…` | `<root>/CLAUDE.md`（导入 `@AGENTS.md`）、`<root>/.claude/skills/<skill>/…` |

不生成 `.dsh/skills/`：DSH 自己就会读 `<root>/.agents/skills/` 与 `~/.agents/skills/`，
再写一份 `.dsh` 只会让同一份技能被维护两次。

## 卸载

`init` 会在作用域根写一份**安装清单**：

| 作用域 | 清单位置 |
| --- | --- |
| user | `~/.agents/agentscaffold.manifest.json` |
| project | `<root>/.agents/agentscaffold.manifest.json` |

清单逐文件记录相对路径、内容 sha256 与来源。卸载就是照单删除：

```bash
agentscaffold uninstall                 # 自动探测：有哪个作用域就列出哪个（只有一个也照样给选项）
agentscaffold uninstall --scope user    # 指定作用域
agentscaffold uninstall --dry-run       # 只报告要删什么
```

规则：

- **没有清单就不猜**：两个作用域都没有清单时报错退出（exit 2），不做任何删除。
- **默认只删"还是我们装的那份"**：安装后被你改过的文件会被保留并列出，
  同时清单只保留这些条目，方便你之后再决定；`--force` 才会连同修改一起删除。
- 删除后清理被清空的目录（例如整个 `.agents/`），但不会删除非空目录，也不会碰清单外的文件。
- 非交互模式下同时存在两个作用域时必须用 `--scope` 指定。

## 代提交

项目级 `init` 与 `uninstall` 完成后，会多问一步"要把本次改动提交到当前仓库吗？"：

- 只 `git add` **本次涉及的路径**，并用 `git commit -- <路径>` 只提交这些路径——你已暂存的无关改动会原样留在暂存区。
- **绝不 push**。
- TUI 里默认是 No；非交互模式需要显式加 `--commit`。
- **当前目录还不是 git 仓库时，这一步会变成「要我 `git init` 再提交吗？」**：同意才 `git init`（默认分支 `main`），
  不加 `--commit` 时绝不擅自初始化仓库。
- 还没配置 git 身份（`user.name` / `user.email`）时，会直接给出该执行的 `git config` 命令，
  并说明仓库已初始化、只是没提交。

## 许可证

本工具自身使用 MIT。

随包某些技能文件为 MPL-2.0，仅这些文件受 MPL。逐文件清单见
[`packs/perf-regression-triage/THIRD-PARTY-NOTICES.md`](packs/perf-regression-triage/THIRD-PARTY-NOTICES.md)，
上游原文按原样保留在该技能目录的 `upstream/` 下（含 `PROVENANCE.json` 记录 commit 与逐文件 blob）。

使用本工具不会要求你开源你的项目，也不会改变你项目的许可证。
项目级安装会把这些 MPL 文件放入项目目录；再分发时请保留随附声明。

MPL-2.0 是文件级 copyleft，不要求开源你的项目其他部分。注意不要把这些 MPL 文件的内容
合并进你自己的源文件——合并后的文件可能受 MPL 约束。

本工具非 Mozilla/Firefox 官方项目，未获 Mozilla 背书。
Firefox、Mozilla 是其各自所有者的商标。

## 随包技能包

### `perf-regression-triage`（MPL-2.0 衍生）

性能回归从告警到修复的端到端流程：读告警 → 确认真假 → 定位成因 → 迭代到修复 → 关闭。
数据源不写死，按项目根的 `.agents/perf-triage.config.json` 声明（适配器模板与三种常见形态见
技能的 `references/adapters.md`）。

工作流改写自 `mozilla-firefox/firefox` 的公开 agent 技能，去掉了 Mozilla 专有工具链
（`mach try` / Perfherder / Bugzilla MCP）；上游原文保存在 `upstream/` 以便对照。

所需 CLI 由技能包声明，`init` / `doctor` 只做探测与建议：

| CLI | 必需 | 缺失时的退路 |
| --- | --- | --- |
| `git` | 是 | 无——没有版本控制无法归因 |
| `curl` | 否 | 不用它就只能依赖告警源自带 CLI |
| `gh` | 否 | 网页端人工流转 |
| `profiler-cli` | 否 | 换成你技术栈的采样器（samply / perf / py-spy / `node --cpu-prof`） |
| `treeherder-cli` | 否 | 用 `curl` 直连告警源 REST API |

## 目录

```
src/bin/             CLI 入口（commander）
src/commands/        init / license / doctor
src/init/            作用域、计划、落盘、模板、CLI 探测
src/license/         许可报告（human / json / --help 短文案）
src/pack/            技能包清单加载
src/ui/              glyph 回退、颜色、clack 封装、进度条
packs/<pack>/        技能包：pack.json + skills/ + upstream/ + 通知文件
scripts/smoke.mjs    端到端冒烟（不碰真实 HOME）
```

## 开发

```bash
npm install
npm run build     # tsc + chmod bin
npm run smoke     # 50 项端到端断言
```

冒烟测试覆盖：项目级未确认声明必须被拒绝且不落盘、`--claude` 才动 `.claude/`、
重复运行幂等、`--dry-run` 不写盘、用户级安装不污染 HOME 根与 `AGENTS.md`、
`CLAUDE.md` 的 `@` 导入必须解析到真实存在的 `AGENTS.md`（两种作用域各验一次）、
`--license --json` 结构、「`AGENTS.md` 里不得混入 MPL 内容」、
**进度条帧宽在任何终端列宽下都不超过 `columns - 1`**（超宽会折行，使 `\r` 失效、每帧新起一行；
详见 `src/ui/progress.ts` 的注释）、note 文案按分句折行，以及：

- 清单：`init` 写出的清单含 schema/scope/逐文件 sha256，且不把用户既有文件记进去
- 卸载：清单内文件删净、空目录清理、清单外的文件保留、无清单时报错退出 2
- 卸载安全阀：安装后被改过的文件默认保留且清单只留这些条目；`--force` 才连改动一起删
- 卸载选择：两个作用域同时存在时非交互必须 `--scope`，指定作用域不会波及另一个
- 代提交：只提交本次路径（故意先暂存一个无关文件，验证它不会进提交也不被清出暂存区），
  非交互不加 `--commit` 不产生提交，用户级安装不触发提交步骤
- 代提交（未初始化仓库）：不加 `--commit` 不会顺手 `git init`；加了会先 `git init -b main` 再提交；
  缺少 git 身份时给出可照做的 `git config` 提示且不产生空提交

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

## 本项目提供什么技能

技能以**技能包**为单位随包分发：装一个包 = 装它声明的全部技能，外加许可证与第三方声明。
每个技能就是一个目录（`SKILL.md` + `references/`），agent 靠 `SKILL.md` 里 `description`
自动判断该不该加载——**不需要你手动调用，说对话就生效**。

当前随包提供：

| 技能包 | 技能 | 解决什么问题 | 什么时候会被自动加载 |
| --- | --- | --- | --- |
| `perf-regression-triage` | `perf-regression-triage` | 性能回归告警没人系统处理：要么没人看，要么没确认真假就动手优化 | 给出性能回归告警（如「某测试在某天回归 N%」）、要判断告警真假、解读 base/new 对比结果，或问「我这次改动是不是把某基准跑慢了」 |

### `perf-regression-triage` — 性能回归从告警到修复

**它解决的问题。** 性能告警通常长这样：「X 测试在 Y 日回归 12%」，然后一直挂着。真去处理时
最常见的两种错法：跳过判断直接开始优化（结果发现告警是噪声），或者改完只看一个百分比就宣布修好。
这条技能把「**先判定真假 → 再归因 → 最后才改**」固化成有顺序、有产出的流程，并要求每一轮都便宜。

**装上以后的"效果"**——同样一个性能回归任务，agent 的行为差别是：

| 没有这条技能 | 有这条技能 |
| --- | --- |
| 看到告警直接开始改代码 | 第 2 步先做复现实验；不复现就走关闭流程，不浪费一轮优化 |
| 触发多轮 CI 各看一半 | 一次触发同时拿到 base 与 new，一条告警只回答一个问题 |
| 把参考文档一次性读进上下文 | 走到哪一步才读哪一篇，长案例留在 `references/` |
| 把 profile 原文塞进上下文 | 走采样器的结构化查询，只取热点与调用栈 |
| 「大概修好了」 | 必须落到四种结论之一（修复 / 回退 / 确认是噪声 / 确认是可接受取舍），并留下数字与依据 |
| 顺手 push、顺手改无关代码 | 任何推送、回退、改 CI 都要先得到你的批准（技能正文里明确写着） |
| 在多个可疑提交里挑一个最像的 | 分不清时必须明说，不许猜 |

**它的五步**（每一步的产物是下一步的输入，不跳步）：

0. **确定数据源**：读项目根 `.agents/perf-triage.config.json`；没有就先问，不猜端点。
1. **读告警**：取告警 ID、culprit revision、base/new、回归的测试与平台。
2. **确认真假**：在任何调查之前，让 base 与 new 跑同一批测试；结果分
   「复现 / 不复现 / 模棱两可」三种，只有复现才继续。
3. **定位成因**：优先用告警自带的前后 profile，对照这次改动；常见成因就那几类
   （热路径多了工作、丢了快路径、多了一次分配、主线程多了同步等待）。
4. **迭代到修复**：改一处 → 跑最小对照 → 看数字；收窄测试集与平台，只有最后一次确认才跑完整测试集。
5. **关闭**：四种结论任选其一，并留下必留信息（两侧 revision、复现次数、绝对值与百分比、认可人）。

**你需要准备什么。** 只有一件：把数据源告诉它，写在项目根的 `.agents/perf-triage.config.json`
（告警源、revision 来源、profile 工具、CI 触发方式、issue 跟踪）。模板与三种常见形态
（告警库 + REST / CI 基准作业 / 本地自建基准）见技能自带的 `references/adapters.md`；
profile 工具按技术栈选（Gecko → `profiler-cli`、Linux → `perf` / `samply`、Python → `py-spy`、
Node → `--cpu-prof`……）。**不配也能用**：它会先问你，而不是替你猜。

**它不做什么**（边界明确，避免误触发）：不负责单纯跑性能测试、不负责分析已经在手的 profile、
不负责非性能类回归（测试失败、崩溃、构建失败），也不负责 JS 引擎微基准。

**它需要的 CLI**（由技能包声明，`init` 与 `doctor` 只探测与建议，从不代装）：

| CLI | 必需 | 缺失时的退路 |
| --- | --- | --- |
| `git` | 是 | 无——没有版本控制无法归因 |
| `curl` | 否 | 不用它就只能依赖告警源自带 CLI |
| `gh` | 否 | 网页端人工流转 |
| `profiler-cli` | 否 | 换成你技术栈的采样器（samply / perf / py-spy / `node --cpu-prof`） |
| `treeherder-cli` | 否 | 用 `curl` 直连告警源 REST API |

**来源与许可。** 工作流改写自 `mozilla-firefox/firefox` 公开的 agent 技能，去掉了 Mozilla 专有工具链
（`mach try` / Perfherder / Bugzilla MCP）；上游原文按 MPL-2.0 原样保存在该技能的 `upstream/` 下以便对照，
逐文件改动说明见 [`packs/perf-regression-triage/THIRD-PARTY-NOTICES.md`](packs/perf-regression-triage/THIRD-PARTY-NOTICES.md)。

### 自己加一个技能包

在 `packs/<包名>/` 放一个 `pack.json`，`init` 就会自动发现：

```
packs/<包名>/
  pack.json                      # name/version/description/license + skills[] + cli[]
  skills/<技能名>/SKILL.md        # 技能入口（frontmatter 需含 name 与 description）
  skills/<技能名>/references/     # 按需读取的长文档
  upstream/                      # 可选：原样保留的上游文件
  LICENSE-* / THIRD-PARTY-NOTICES.md / TRADEMARKS.md
```

`cli[]` 每项声明 `name` / `required` / `why` / `install` / `fallback`，`init` 与 `doctor`
用它们做探测与报告；技能装到作用域的技能目录后即被 agent 发现，不需要额外注册。
写技能时记住两条：`description` 会在每次会话进入上下文（写清「什么时候该用 + 什么时候不该用」），
正文按需读取（长案例拆到 `references/`，并说明走到第几步才读哪一篇）。

## 目录

```
src/bin/             CLI 入口（commander）
src/commands/        init / uninstall / license / doctor
src/init/            作用域、计划、落盘、模板、安装清单、CLI 探测
src/license/         许可报告（human / json / --help 短文案）
src/pack/            技能包清单加载
src/ui/              glyph 回退、颜色、宽度与折行、clack 封装、进度条
src/util/            文件、git 代提交、版本
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

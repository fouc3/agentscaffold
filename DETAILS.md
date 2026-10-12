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
| 装附加技能包（默认不装） | `agentscaffold init --add-packs profile-analysis` |
| 只写文档、不装技能 | `agentscaffold init --no-skills` |
| 覆盖已有文件 | `agentscaffold init --force` |
| 完成后提交本次改动（项目级） | `agentscaffold init --scope project --accept-mpl-notice --commit` |
| 顺便安装缺失的可选工具 | `agentscaffold init --install-tools` |
| 卸载（自动探测作用域） | `agentscaffold uninstall` |
| 只卸载某一作用域 | `agentscaffold uninstall --scope user\|project` |
| 预览卸载 | `agentscaffold uninstall --dry-run` |
| 连改过的文件一起删 | `agentscaffold uninstall --force` |
| 卸载后提交本次改动 | `agentscaffold uninstall --commit` |
| 检查安装状态与 CLI | `agentscaffold doctor [path] [--scope user\|project] [--json]` |
| 检索代码（定义/标识符/文本/调用关系） | `agentscaffold search <关键词> [--kind define\|id\|text\|callers\|callees\|impact] [--path <dir>] [--glob <g>] [--ext <e>] [--limit N] [--json]` |
| 进检索 TUI | 不带参数运行 `agentscaffold`（只在真终端里） |
| 生成上下文规则模板 | `agentscaffold context --init [path]` |
| 校验上下文规则 | `agentscaffold context --check [path] [--rules <file>] [--json]` |
| 看这次改动该读什么 | `agentscaffold context [path] [--since <ref> \| --range <a...b> \| --changed <files...>] [--json]` |
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

## 可选工具安装

`init` 在报告完 CLI 状态之后，会问一次「是否安装缺失的可选工具？」，默认一个都不勾选：

- **只有技能包显式声明 `installArgv` 的工具才会被提供**。只写 `install`（给人看的建议）是不够的，
  包作者不写 `installArgv` 就等于没授权本工具去执行任何东西。
- 安装命令以 **argv 数组**执行，从不经过 shell，因此技能包里的数据无法注入 shell 语法。
- 非交互模式需要显式 `--install-tools`；不加就只报告。
- 失败会带上该执行的完整命令；识别为权限问题（如 `npm i -g` 写 `/usr`）时提示你自己执行，
  **不会**自动加 sudo、不重试。
- 单个安装最长 15 分钟，超时终止并报告。

## 检索（`agentscaffold search` / 无参数进 TUI）

设计思路借自 [`padenot/searchfox-cli`](https://github.com/padenot/searchfox-cli)：一个给 AI 用的
代码检索 CLI，提供定义、标识符、调用关系查询，输出适合 LLM 读。它需要联网并只覆盖 Mozilla 的
索引，因此这里**只借查询形状**，后端换成完全本地的实现，代码不复用、不联网。

| 能力 | 后端 | 没有后端时 |
| --- | --- | --- |
| 文本检索 `--kind text`（支持 `--glob` / `--ext`） | `rg`，缺失时退回 `grep -rnF` | 始终可用 |
| 标识符 `--kind id`、定义 `--kind define`（给完整源码块） | `codegraph` + 该项目已建索引 | 明确报“需要索引”，给出 `codegraph init <dir>` 与退路，退出码 2 |
| 调用关系 `--kind callers\|callees\|impact` | 同上 | 同上 |

- `--define` 的选择顺序：class / struct / interface / enum / function / method / constructor…——
  先要类定义，其次函数实现，不拿一行上下文充数（对齐 searchfox-cli 的 `--define` 行为）。
- codegraph 是**可选**依赖：声明在工具级依赖表里（`why` / `install` / `installArgv` / `fallback`），
  因此 `init` 与 `doctor` 会报告它，`init` 的“安装缺失的可选工具”步骤可以经你同意后安装它。
  **我们从不自动安装，也从不自动建索引**（后者可能耗时很久）。
- 无参数运行：真终端 → 检索 TUI；非 TTY / `AGENTSCAFFOLD_NO_TUI=1` / 设置了 `CI` → 打印 help
  （在无法输入的地方弹提示只会像卡死），退出码 0。
- 输出是 markdown（借 searchfox-cli 面向 LLM 的那一点）；`--json` 带 `backends`、`needs_index`、`hits`。
  退出码：0 有命中、1 无命中、2 用法错误或缺少所需索引。
- 调用关系查询命中索引失败时（codegraph 对“找不到符号”也返回 0）会额外提示先用 `--kind id`
  确认准确符号名，避免把“查不到”显示成“没有调用者”。

## 上下文规则（`agentscaffold context`）

照 Firefox 的 `review-context.toml`（Review Helper）实现，格式**保持 TOML**、谓词与 `load` 写法一致，
所以那份文件里的规则改改路径就能用（解析用 TOML 1.0 实现 `smol-toml`，不自己写子集解析器）。

- 规则文件：`<项目>/.agents/context-rules.toml`；`--rules <path>` 可指向别处（`.json` 也认，便于迁移）。
- 谓词：`any_file`（至少一个改动文件匹配）、`all_files`（每个改动文件都匹配，用于「只改文档」这类
  形状规则）、`all` / `any` / `not` 组合；文件谓词 `include` / `exclude` / `ext`。
  **通配符语义与 Firefox 一致**：`*` 也匹配 `/`（Python `fnmatchcase`），所以 `dom/media/**` 匹配整段前缀。
- `load`：`{ type = "file", path = "..." }`（与 Firefox 相同）、`{ path|file = "..." }`、
  `{ skill = "已安装技能名" }`（我们解析成技能目录里的 `SKILL.md` 并附上 description 摘要）、
  或裸字符串路径。相对路径按规则文件所在目录解析。
- 多条规则命中 → **全局去重**；某个 `load` 目标不存在 → 报告后继续（对齐 Firefox 的非致命处理）。
- `--check` 负 validation 的责任（对应 `mach lint review-context.toml`）：未知字段、`when` 缺条件键、
  谓词类型不对、`load` 为空或没有目标，都会被拒并退出 2。
- 输出是「该读什么」的清单 + 每条的命中理由（markdown / `--json`）。**注入不属于本工具**：
  Firefox 是 Review Helper 把内容作为受信任 `<context>` 放在 diff 之前，我们只产出这份清单，
  谁能消费由宿主决定。
- 取改动文件：`--since <ref>` = `git diff --name-only <ref>`（工作区 vs 该 ref，所以 `--since HEAD`
  看的就是未提交改动）；`--range <a...b>` = 原样传给 git 的三点比较（PR 式）；`--changed` 手动指定。
  早先两处都用 `<ref>...HEAD` 是错的：`--since HEAD` 会变成 HEAD 与自分之比较，永远是空集。

## Firefox 的 AI 机制：逐条取舍

判定标准是"离开 Mozilla 这个环境还能不能用"，不是"我实现起来累不累"。

| Firefox 的做法 | 判断 | 本项目的落点 |
| --- | --- | --- |
| 根 `AGENTS.md` 短而硬（73 行）+ 模块细节下沉 | 通用 | 已实现（`init` 生成模板；原理见 `prompt-placement` 技能） |
| 子目录 `AGENTS.md` 就近声明局部约定 | 通用 | 已支持（模板里留了索引位）；体检命令尚缺 |
| `CLAUDE.md` 只有一行 `@AGENTS.md`（单一真源） | 通用 | 已实现（`--claude`） |
| `.agents/skills` + `.claude/skills` 双入口 | 通用 | 已实现（默认 `.agents/`，`--claude` 追加） |
| 技能 `description` 常驻、正文按需、`references/` 分层 | 通用 | 已实现 + 写作约束（见下） |
| 同一案例给两份（`-cli.md` 工具版 / 通用版） | 通用 | 已写入本文件的技能写作约束 |
| 技能里带脚本（`file-bug.py`、`trigger-tests.sh`） | 通用 | 已支持（技能目录下任何文件都会随技能安装） |
| `review-context.toml` 机械触发（本文件上一节） | **通用** | **已实现** `agentscaffold context`，保持 TOML |
| 规则可被 lint（`mach lint review-context.toml`） | 通用 | 已实现（`context --check`） |
| 加载失败非致命 + 全局去重 | 通用 | 已实现（有断言） |
| 把内容作为受信任 `<context>` 注入到 diff 之前 | 半通用：注入是宿主职责 | **只产出清单**，不注入；输出里说明注入顺序 |
| 外部技能来源（`extraKnownMarketplaces` + `autoUpdate`） | 通用 | **待做**：pack 支持外部来源（git/pkg），目前只随包分发 |
| `.mcp.json` 声明 MCP 服务器 | 不通用（各家 harness 的 MCP 形态不同，且我们是 CLI） | 丢弃 |
| `mach` 挂 AI 命令（构建系统入口） | 不通用（Firefox 构建系统专有） | 丢弃；我们的入口就是 `agentscaffold` |
| 技能 frontmatter 的 `allowed-tools: Bash(searchfox-cli:*)` | 不通用（Claude 专有字段，别的 harness 会忽略） | 改写：依赖用 `pack.json` 的 `cli[]` 声明（含 install/fallback） |
| `searchfox-cli`（联网查 Mozilla 索引） | 不通用（需联网 + 只覆盖该仓） | **借查询形状、本地重写**（`agentscaffold search`） |
| `profiler-cli` / `treeherder-cli` 等 Mozilla 专用工具 | 不通用（查的是 Mozilla 服务） | 作为可选 CLI 声明在技能包里，缺了给退路 |
| Bugzilla / Phabricator 的 MCP 资源（`@moz:…`） | 不通用（Mozilla 服务） | 丢弃 |
| bugbug 里的扩展谓词（评审/补丁元数据、仓库白名单、`fetch_revision`） | 不通用（评审服务特有） | 丢弃；谓词层留了扩展空间 |
| `docs/ai-agent-tools/` 把机制写成文档 | 通用 | 已实现（本文件 + README） |
| 技能"成本纪律"（写明读哪一篇、别整篇塞上下文） | 通用 | 已用在我们的技能里，写入写作约束 |

## 技能包格式

```
packs/<包名>/
  pack.json                      # name/version/description/license/optional
                                 #   skills[]：技能名 + 目录
                                 #   cli[]：依赖的工具
                                 #   upstream[]（可选）：来源仓库/路径/固定提交/许可/文件清单
  skills/<技能名>/SKILL.md        # 技能入口：frontmatter 需含 name 与 description
  skills/<技能名>/references/     # 按需读取的长文档
  upstream/                      # 可选：原样保留的上游文件 + PROVENANCE.json
  LICENSE-* / THIRD-PARTY-NOTICES.md / TRADEMARKS.md
```

`optional: true` 的包是**附加包**：默认不装，`init` 会单独问一步（永不预选），
非交互模式需要 `--add-packs <名字>`（`--skills <名字>` 也能显式装上）。
附加包的文件同样进安装清单，`uninstall` 一并清理。

随包提供（`agentscaffold packs` 可列）：

| 包 | 默认 | 内容 |
| --- | --- | --- |
| `perf-regression-triage` | 装 | 性能回归从告警到修复（含 MPL-2.0 上游文件） |
| `prompt-placement` | 装 | 提示词该放哪一层：四层职责、判定顺序、反模式、仓库体检五步（纯 MIT，本项目原创） |
| `profile-analysis` | 不装（附加） | 读懂一份性能记录，给出可行动的结论（纯 MIT，本项目原创） |

`cli[]` 每项字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 可执行文件名（用于探测） |
| `required` | 缺失是否导致技能不可用 |
| `why` | 为什么需要它（`doctor` 报告里显示） |
| `install` | 建议的安装命令（只显示，不执行） |
| `installArgv` | 同上，但用 argv 数组写。**写了它才会在 `init` 里被提供安装**，从不走 shell |
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
npm run smoke     # 71 项端到端断言
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
- **可选工具**：只挑「缺失 + 声明了 `installArgv`」的；安装命令以 argv 传递（断言 `$HOME;rm -rf`
  这类参数不被 shell 解释）；失败时识别权限问题；随包技能包确实声明了可安装的工具；
  非交互不加 `--install-tools` 时只报告不安装。
- **附加包**：默认不装；`--add-packs` 才装并带上自己的 `LICENSE-MIT`（MIT 包不该带 MPL 文件）；
  清单记录追加包且卸载一并清干净；`--skills` 显式点名也能装；清单里 MPL 与 MIT 的划分不错位。
- **交互可继续性**：`init` 里的多选步骤都设了 `required: false`——clack 默认要求「至少选一个」，
  不放开的话「一个都不装」在 TUI 里根本提交不了（这是实测踩到的坑）。
- **检索**：非交互无参数只打印 help；文本检索在没有索引的目录里也能命中（`--glob` 的语义必须与
  ripgrep 一致，否则 rg 过滤与我们的后过滤会打架）；需要索引的查询在无索引时退出 2 并给出
  `codegraph init` 与 `--kind text` 退路；`--json` 带后端与 `needs_index`；非法 `--kind` 退出 2；
  另外断言 codegraph 在依赖表里是**可选**且写明了退路。装了 codegraph 时会临时给
  `scripts/fixtures/sample-project` 建索引，验证标识符、完整定义正文与调用关系；没装则跳过那三条。
- **上下文规则**：`--check` 通过/拒绝（未知字段、缺条件键）；`all` + `any_file` 的组合按预期命中，
  只改一类文件时不命中；`all_files` 用于「只改文档」这类形状规则，混入源码就不算；`not` 生效；
  `include` + `exclude` + `ext` 三件套（Firefox 前端那条的形状）；同一文件被多条规则加载时全局去重；
  `{ skill = "..." }` 解析成已安装技能的 `SKILL.md` 并带上 frontmatter 摘要；`load` 目标缺失只警告
  且退出 0；`--list` 的判据描述可读；无规则文件退出 1 并给 `--init`；`--init` 生成 TOML 模板且不覆盖；
  `--since HEAD` 从 git 取改动文件、`--range a...b` 走三点比较；`--rules` 指向 `.json` 也认。

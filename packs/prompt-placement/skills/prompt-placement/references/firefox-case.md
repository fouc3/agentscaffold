# Firefox 的提示词分层：实测数据与复核方法

数据来自公开仓库 [`mozilla-firefox/firefox`](https://github.com/mozilla-firefox/firefox)，
用 GitHub API 读取，不用克隆。数字会随上游变化，**用下面的命令自己复核一遍**再引用。

## 实测结构（2026-10 复核）

| 位置 | 行数 | 字节 | 角色 |
| --- | --- | --- | --- |
| `AGENTS.md` | **73** | 7388 | 根指令：跨模块硬规则 + 索引 |
| `CLAUDE.md` | 1 | 11 | 只有一行 `@AGENTS.md`，把 Claude 的入口指向同一份 |
| `js/AGENTS.md` | 80 | 3703 | JS 引擎模块约定 |
| `layout/AGENTS.md` | 31 | 1360 | 布局模块约定 |
| `gfx/wr/AGENTS.md` | 123 | 5769 | WebRender 模块约定 |
| `browser/extensions/newtab/AGENTS.md` | 85 | 5453 | 新标签页扩展约定 |
| `browser/extensions/webcompat/AGENTS.md` | 128 | 8013 | Web 兼容扩展约定 |
| `review-context.toml` | 67 | 1788 | **机械路由**：什么补丁 → 加载哪份技能 |
| `.claude/skills/` | — | — | 26 个按需技能 |
| `.agents/skills/` | — | — | 通用技能目录（同一批技能的另一入口） |
| `.mcp.json` | 23 | 490 | MCP 服务声明 |

整仓 `AGENTS.md` 一共 **6 份**：根 + `js/` + `layout/` + `gfx/wr/` + `newtab/` + `webcompat/`。

## 复核命令

```bash
R=mozilla-firefox/firefox

# 根文件行数与字节
gh api -H "Accept: application/vnd.github.raw" repos/$R/contents/AGENTS.md | wc -lc

# 全仓 AGENTS.md 有哪些
gh api "search/code?q=repo:$R+filename:AGENTS.md&per_page=100" --jq '.items[].path'

# 各层大小对比（把路径换成你想看的）
gh api repos/$R/contents/js/AGENTS.md --jq '.size'

# 机械路由配置文件全文
gh api -H "Accept: application/vnd.github.raw" repos/$R/contents/review-context.toml

# 根目录下与 agent 相关的文件
gh api repos/$R/contents/ --jq '.[] | select(.name|test("AGENTS|CLAUDE|\\.claude|\\.agents|review";"i")) | .name'
```

## 根文件里有什么

`AGENTS.md` 的骨架（`#` 级标题）：

```
# Global instructions        ← 全部硬规则都在这里，没有教程
## Tooling for Firefox work  ← 工具入口：有哪些工具、什么时候用
## Fixing review comments
## Referring to code in bugs, reviews and commit messages
## Code Style
## Workflow
```

第一条规则就是**注释要极少**，而且写得可判定：

> Limit the amount of comments you put in the code to a strict minimum. You should almost
> never add comments, except sometimes on non-trivial code, function definitions if the
> arguments aren't self-explanatory, and class definitions and their members.
>
> Do not remove existing comments unless they are directly related to what you are changing.

值得注意的三个写法：

1. **给了例外**（非显然的代码、参数不自解释的函数、类定义），所以不会被执行到极端。
2. **紧跟着一条反向约束**（别删无关的既有注释）——硬规则的常见副作用，被就地堵住了。
3. **索引写在根文件里**：「在这些目录下工作时，见对应目录的 AGENTS.md」并逐条列出目录名，
   下沉之后仍然找得到。

## review-context.toml：第三层机制

这是最容易被忽略、但最有价值的一层——它把「什么时候该读哪份技能」写成**机器可判定的规则**，
不靠模型看描述猜：

```toml
version = 1

[[rules]]
name = "Firefox desktop frontend"
when = { any_file = { include = ["browser/**", "toolkit/**", "devtools/**"],
                      exclude = ["**/test/**", "**/tests/**"],
                      ext = [".js", ".mjs", ".html", ".xhtml", ".css", ".svg"] } }
load = [
  { type = "file", path = ".claude/skills/firefox-desktop-frontend/SKILL.md" },
]
```

三条规则覆盖了三种判定方式：

- **目录 + 扩展名 + 排除测试**：前端约定
- **多条件与**（同时碰 `.webidl` 和 `.h/.cpp`）：WebIDL 实现
- **单目录前缀**（`js/**`）：JS 引擎评审

而且它是**可校验的数据**：文件头写明用 `./mach lint review-context.toml` 在提交前验证。
这一点很关键——配置能进 lint，就说明它被当成代码而不是文档来维护。

## 从这个案例能学到的

1. **根文件短，不等于信息少**：73 行里放的是「每个模块都适用」的硬规则与路由入口。
2. **模块细节就近放**：不同模块的约定行数差 4 倍（31 行 vs 128 行），谁复杂谁多写，不平均分配。
3. **技能按需加载**：26 个技能的正文都不常驻，常驻的只有各自一行描述。
4. **能在结构里表达的，别用自然语言表达**：文件匹配交给配置，判断交给工具。
5. **单一真源**：`CLAUDE.md` 只有一行 `@AGENTS.md`，同一份规则不抄两遍。

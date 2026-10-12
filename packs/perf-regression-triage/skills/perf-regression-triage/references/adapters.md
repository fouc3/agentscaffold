---
title: 适配器配置与三种常见告警源
license: MIT
---

<!--
License: MIT
Source: agentscaffold（本项目原创，非上游派生文件）
-->

# 适配器：把这条技能接到你自己的数据源上

技能正文不写死任何端点或命令，一切都从项目根的配置来：

```
.agents/perf-triage.config.json
```

## 配置模板

```json
{
  "alertSource": {
    "kind": "rest",
    "endpoint": "https://<host>/api/performance/alertsummary",
    "idParam": "id",
    "idField": "id",
    "notes": "按 id 过滤是唯一可靠的过滤方式；其它过滤参数是否生效要先验证"
  },
  "revisionSource": {
    "kind": "git",
    "culpritField": "revision",
    "baseField": "prev_push_revision"
  },
  "profileSource": {
    "kind": "cli",
    "tool": "samply",
    "load": "samply load <profile-path>",
    "report": "samply load <profile-path> -- --json"
  },
  "testRunner": {
    "kind": "github-actions",
    "workflow": "bench.yml",
    "trigger": "gh workflow run bench.yml -f base=<base> -f new=<new>",
    "watch": "gh run watch <run-id>"
  },
  "issueTracker": { "kind": "github", "repo": "<owner>/<name>" }
}
```

字段缺失时**先补配置再干活**，不要临时猜一个端点。

## 形态 A：告警库 + REST（最省事）

适用：告警本身带 `id`、`revision`、`prev_revision`、`amount_pct`、测试签名。

要点：

- **带查询串的 URL 必须加引号**（`?` 与 `&` 会被 shell 当成通配与后台符）：
  `curl -s 'https://<host>/api/...?id=<ID>'`
- **先验证过滤参数是否真的生效**：有一类端点对无法识别的过滤参数既不报错也不过滤，
  返回的是全量数据，调用方读到第一条就当成了答案。判断方法：换一个不同的参数值再请求一次，
  看返回是否变化；不变就是没生效。
- 分页要显式翻页（`?page=N`），不要假设一次返回就是全部。

## 形态 B：CI 里的基准作业（GitHub Actions 系）

适用：回归来自某个 workflow 里跑基准的 job。

- 取近期运行与产物：
  - `gh run list --workflow <file> --limit 30 --json databaseId,headSha,conclusion,createdAt`
  - `gh run view <run-id> --log` 或下载 artifact（`gh run download <run-id>`）
- 触发 base/new 对照：`gh workflow run <file> -f base=<base> -f new=<new>`，再 `gh run watch` 等结果。
- **没有用户明确批准不要触发**：把命令与预计消耗说清楚再等确认。
- 只比 `headSha` 与你关心的那次提交**同平台**的数字；不同 runner 机型之间的数字不可比。

## 形态 C：本地/自建基准

适用：`hyperfine`、`criterion`、`pytest-benchmark`、自定义脚本。

- 每个版本至少跑同样的次数与同样的输入；把原始数字落盘（JSON/CSV），不要只留结论。
- 比较用同一台机器、同一电源/散热状态；跑前记录负载与是否插电。
- 抖动大时先提高重复次数，再看是否存在超过噪声的差异。

## profile 工具按技术栈选

| 栈 | 工具 | 备注 |
| --- | --- | --- |
| Gecko / Firefox | `profiler-cli`（`npm i -g @firefox-devtools/profiler-cli`） | 先 `profiler-cli guide`；用命名 session，不要 `stop --all` |
| Linux 原生程序 | `perf record` + `perf report`，或 `samply` | 需要符号时确保带 debug 信息 |
| Android | `simpleperf` | 非 root 也可用 |
| Python | `py-spy record --flamegraph` | 对运行中的进程附加 |
| Node.js | `node --cpu-prof` | 产出的 `.cpuprofile` 可直接在 Chrome DevTools 里看 |
| Go | `pprof` | `go tool pprof` |

**不要把 profile 原文整份读进上下文**：一律走工具的结构化查询（火焰图统计、热点函数列表），
需要细节时再定向取。

## 新增一个适配器

1. 在上面的模板里填出四件事：告警从哪来、base/new 怎么拿、profile 怎么读、对照怎么跑。
2. 在 `references/` 里加一份短文档记录该源特有的坑（过滤参数陷阱、分页、机型差异）。
3. 只记录**行为事实**（什么参数不生效、什么命令真能跑通），不要抄别人的文档正文。

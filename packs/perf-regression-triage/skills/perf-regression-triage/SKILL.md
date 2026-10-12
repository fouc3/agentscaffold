---
name: perf-regression-triage
description: >
  处理一条性能回归告警：读告警、确认真假、定位成因、迭代到修复。
  当用户给出性能回归告警（例如「某测试在某天回归 N%」）、需要判断一个告警是否真实、
  在解读 base/new 两次运行的对比结果、或问「我这次的改动是不是把某个基准跑慢了」时使用。
  不负责：单纯运行性能测试（用项目自己的跑法）、分析已经在手的 profile（交给采样器流程）、
  非性能类回归（测试失败、崩溃、构建失败），也不负责 JS 引擎微基准。
license: MPL-2.0
source: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/SKILL.md
---

<!--
License: MPL-2.0
Source: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/SKILL.md
Modified: yes
说明: 由 mozilla-firefox/firefox 的同名技能改写为通用适配器形态；上游原文见同目录 upstream/。
-->

# 性能回归归因

一条性能回归告警（"X 测试在 Y 日回归 N%"）到修复，固定五步。**每一步的产物是下一步的输入**，
不要跳步，尤其不要在没确认回归真假之前就开始优化。

## 第 0 步：确定数据源（必做，只做一次）

告警源、revision 来源、profile 工具、CI 触发方式在不同项目里完全不同，本技能不写死它们。
先读项目根的适配器配置：

```
.agents/perf-triage.config.json
```

- **文件存在**：按里面的 `alertSource` / `revisionSource` / `profileSource` / `testRunner` / `issueTracker`
  决定每一步用什么命令。字段含义与三种常见形态见 `references/adapters.md`。
- **文件不存在**：不要猜。先运行 `agentscaffold doctor` 看本机有哪些 CLI 可用，
  再问用户告警从哪里来，然后照 `references/adapters.md` 的模板写出这个文件再继续。

若配置里某个源只有 CLI 而没有 REST 端点，且该 CLI 缺失：**缺失不是停下来或改用手工捞数据的理由**，
按 `references/adapters.md` 的回退路径走（通常是告警源的 REST API + `curl`）。

成本纪律：读一次配置，然后只读当前这一步需要的参考文件，不要一次性把 `references/` 全读进来。

## 第 1 步：读告警

把这条告警里机器可读的部分全部取出来，再看结论：

- **告警 ID**（后续确认步骤要用它把同一批测试重跑一遍）
- **culprit revision**：被怀疑引入回归的那次提交
- **base / new revision**：对比的两个版本
- **回归的测试**：哪些 case、哪个平台、哪些选项
- **前后 profile 链接**（如果告警带了）

culprit revision 上通常有好几个提交。直接看这次推送里的改动，别去读网页界面的 HTML：

```
git show <rev>
```

判断哪个提交是提问者的、动了哪些文件。如果有多个可疑提交且无法区分，**明确说出来**，
不要挑一个看起来最像的就往下走——第 2 步的确认实验才是判定依据。

如果告警界面丢字段，或只有 CLI 没装，取告警源的 JSON 原文（见 `references/adapters.md` 的端点表）。

给用户的阶段汇报必须包含：回归幅度、涉及的测试、平台、以及被怀疑的改动动了什么。

## 第 2 步：确认真假（在任何调查之前）

**相当一部分告警不会复现。** 这一步的目标只有一个：让 base 与 new 在**同一批测试、同一平台**上各跑一次。

- 触发方式取自配置里的 `testRunner`：CI 手动触发、本地反复跑、或两者结合。
- 重跑次数按噪声水平定：噪声大的基准需要更多次；先用少量次数看趋势。
- **未经用户明确批准，不要推送到共享 CI**。把将要执行的命令、大致 CI 成本说清楚，然后等确认。

结果只有三种：

- **复现** → 进入第 3 步。
- **不复现** → 不要开始优化。走 `references/close-out.md`：多半是噪声，或同一批里另一个提交干的。
- **模棱两可（两组分布重叠）** → 增加重跑次数，或收窄到回归最严重的那一个测试再判。

## 第 3 步：定位成因

优先用告警里已经给出的前后 profile —— 它们免费且正对着回归的那个测试。
把 profile 交给项目配置的 `profileSource` 流程（`references/adapters.md`），
**不要**用网页抓取去读 profile：抓回来的通常只是界面外壳，没有数据。

把 profile 里的热点与第 1 步看到的改动对照。常见成因就那么几类：热路径上多了工作、
丢了一条快路径、多了一次分配、主线程上多了同步等待。

## 第 4 步：迭代到修复

按 `references/iterate.md`：改一次 → 跑最小范围的对照 → 看结果，如此循环。
这个文件的全部意义就是让每一轮都便宜：收窄测试集、只留一个平台，
只有最后确认时才跑完整的那批测试。

## 第 5 步：关闭

按 `references/close-out.md`：可选结论有哪些、要更新哪些字段、什么情况下"这个回归可以接受"、
以及怎么把对这条技能本身的反馈交回去。

## 成本纪律

这条技能存在的意义之一，就是让回归处理在 CI 与 token 两头都便宜。

- **一次只回答一个问题**：base 与 new 在同一次触发里拿到，不要触发两次。
- **先广后窄**：确认阶段跑一次覆盖面大的，迭代阶段只跑最相关的。
- **不要预先读参考文件**，走到哪一步读哪一篇。
- **不要把 profile 原文拉进上下文**：走采样器/CLI 的结构化查询。

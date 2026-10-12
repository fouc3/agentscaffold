# Third-Party Notices

本包包含以下 MPL-2.0 文件。上游文件按原样保留（未修改）；由我们改写的文件在文件头标注了 `Modified: yes`。

## 原样保留（未修改）

- `upstream/SKILL.md`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/SKILL.md
  修改: 否
- `upstream/references/close-out.md`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/references/close-out.md
  修改: 否
- `upstream/references/confirm.md`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/references/confirm.md
  修改: 否
- `upstream/references/iterate.md`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/references/iterate.md
  修改: 否
- `upstream/references/rest-api.md`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/references/rest-api.md
  修改: 否
- `upstream/tests/trigger-tests.sh`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/tests/trigger-tests.sh
  修改: 否

## 改写（MPL-2.0 衍生作品）

- `SKILL.md`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/SKILL.md
  修改: 是
  说明: 去掉 Mozilla 专有工具链（mach try / Perfherder / Bugzilla MCP），改为按项目适配器配置驱动的通用五步流程。
- `references/iterate.md`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/references/iterate.md
  修改: 是
  说明: 去掉 try 推送/alert 参数等专有步骤，保留"每轮收窄、最后一次才跑全量"的成本纪律。
- `references/close-out.md`
  来源: https://github.com/mozilla-firefox/firefox/blob/8e9ac3e12bbaf39d4c282dc8849221aa17d4f714/.claude/skills/perf-regression-triage/references/close-out.md
  修改: 是
  说明: 去掉 Bugzilla 字段与流程，改为通用的四种结论与必留记录。

## 本项目原创（MIT）

- `references/adapters.md`
  来源: agentscaffold（非上游派生）
  修改: 不适用

MPL-2.0 全文: https://www.mozilla.org/MPL/2.0/ ，随本目录以 `LICENSE-MPL-2.0` 分发。

MPL-2.0 是文件级 copyleft。上述义务仅适用于列出的 MPL 文件，不适用于使用本技能的项目中的其他代码。

若你再分发本技能目录：保留上述来源与声明；若修改了列出的 MPL 文件，需公开你修改后的这些文件。
不要把 MPL 文件的内容合并进你自己的源文件——合并后的文件可能整体受 MPL 约束。

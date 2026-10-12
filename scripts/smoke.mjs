// End-to-end smoke test. Never touches the real HOME: user-scope runs get a fake HOME.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'bin', 'agentscaffold.js');
const sandbox = mkdtempSync(join(tmpdir(), 'agentscaffold-smoke-'));
const fakeHome = join(sandbox, 'home');

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push([true, name]);
  } catch (error) {
    checks.push([false, `${name}\n      ${error.message}`]);
  }
}

function run(args, options = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome, AGENTSCAFFOLD_NO_TUI: '1', NO_COLOR: '1' },
    ...options,
  });
}

function runExpectFail(args) {
  try {
    execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: fakeHome, AGENTSCAFFOLD_NO_TUI: '1', NO_COLOR: '1' },
    });
    return { code: 0, output: '' };
  } catch (error) {
    return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

// ── 1. project scope, non-interactive, explicit notice acceptance ────────────
const project = join(sandbox, 'proj');
run(['init', project, '--yes', '--scope', 'project', '--accept-mpl-notice']);

const skillDir = join(project, '.agents', 'skills', 'perf-regression-triage');
check('project: AGENTS.md 写入', () => assert.ok(existsSync(join(project, 'AGENTS.md'))));
check('project: SKILL.md 写入', () => assert.ok(existsSync(join(skillDir, 'SKILL.md'))));
check('project: 通知随技能目录', () => {
  assert.ok(existsSync(join(skillDir, 'THIRD-PARTY-NOTICES.md')));
  assert.ok(existsSync(join(skillDir, 'LICENSE-MPL-2.0')));
  assert.ok(existsSync(join(skillDir, 'TRADEMARKS.md')));
});
check('project: 上游原文保留', () => assert.ok(existsSync(join(skillDir, 'upstream', 'SKILL.md'))));
check('project: 默认不写 .claude', () => assert.ok(!existsSync(join(project, '.claude'))));
check('project: 不把 MPL 内容合并进 AGENTS.md', () => {
  const agents = readFileSync(join(project, 'AGENTS.md'), 'utf8');
  assert.ok(!agents.includes('MPL-2.0'), 'AGENTS.md 不应包含 MPL 正文/标记');
});

// ── 2. project scope without acceptance must be refused ─────────────────────
const refused = runExpectFail(['init', join(sandbox, 'proj2'), '--yes', '--scope', 'project']);
check('项目级未确认声明 → 拒绝 (exit 2)', () => {
  assert.equal(refused.code, 2);
  assert.ok(refused.output.includes('--accept-mpl-notice'));
  assert.ok(!existsSync(join(sandbox, 'proj2', '.agents')), '拒绝后不应写入任何文件');
});

// ── 3. --claude opt-in ──────────────────────────────────────────────────────
run(['init', project, '--yes', '--scope', 'project', '--accept-mpl-notice', '--claude']);
check('--claude: CLAUDE.md 写 @AGENTS.md', () => {
  const body = readFileSync(join(project, 'CLAUDE.md'), 'utf8');
  assert.ok(body.includes('@AGENTS.md'));
});
check('--claude: .claude/skills 就位', () => {
  assert.ok(existsSync(join(project, '.claude', 'skills', 'perf-regression-triage', 'SKILL.md')));
});

// ── 4. idempotency: second run must not rewrite ─────────────────────────────
const second = run(['init', project, '--yes', '--scope', 'project', '--accept-mpl-notice']);
check('二次运行幂等（无 created）', () => assert.ok(!second.includes('[created]'), second));
check('二次运行无 skipped（内容一致）', () => assert.ok(second.includes('[unchanged]'), second));

// ── 5. --dry-run writes nothing ─────────────────────────────────────────────
const dry = join(sandbox, 'dry');
const dryOut = run(['init', dry, '--yes', '--scope', 'project', '--accept-mpl-notice', '--dry-run']);
check('--dry-run 不落盘', () => {
  assert.ok(!existsSync(join(dry, 'AGENTS.md')));
  assert.ok(!existsSync(join(dry, '.agents')));
  assert.ok(dryOut.includes('[created]'), '应报告将要创建的条目');
});

// ── 6. user scope goes to $HOME and stays out of any repo ───────────────────
run(['init', '--yes']);
check('user scope: ~/.agents/skills 写入', () => {
  assert.ok(existsSync(join(fakeHome, '.agents', 'skills', 'perf-regression-triage', 'SKILL.md')));
  assert.ok(existsSync(join(fakeHome, '.agents', 'AGENTS.md')));
});
check('user scope: 不写 ~/.claude', () => assert.ok(!existsSync(join(fakeHome, '.claude'))));
check('user scope: 不在 HOME 根丢 AGENTS.md', () => assert.ok(!existsSync(join(fakeHome, 'AGENTS.md'))));

// ── 7. licence surfaces ─────────────────────────────────────────────────────
const help = run(['--help']);
check('--help 只有一行级许可提示', () => {
  assert.ok(help.includes('License:'));
  assert.ok(!help.includes('MPL-2.0 要点'), '--help 不应包含完整文案');
});
const human = run(['--license']);
check('--license 完整文案', () => {
  assert.ok(human.includes('MPL-2.0 要点'));
  assert.ok(human.includes('不得用 Mozilla/Firefox 名称或 logo'));
  assert.ok(human.includes('本说明不是法律意见。'));
});
const json = JSON.parse(run(['--license', '--json']));
check('--license --json 结构正确', () => {
  assert.equal(json.tool, 'agentscaffold');
  assert.equal(json.tool_license, 'MIT');
  assert.equal(json.project_license_impact, 'none');
  assert.ok(Array.isArray(json.mpl_files) && json.mpl_files.length > 0);
  assert.ok(json.mpl_files.some((file) => file.endsWith('upstream/SKILL.md')));
  assert.ok(!json.mpl_files.some((file) => file.includes('adapters.md')), '原创文件不应计入 mpl_files');
  assert.ok(!json.mpl_files.some((file) => file.includes('PROVENANCE.json')), '我们写的溯源元数据不应计入 mpl_files');
  assert.ok(!json.third_party_notices.startsWith('/'), 'third_party_notices 应为可移植路径/URL，不是本机绝对路径');
  assert.equal(json.mpl_url, 'https://www.mozilla.org/MPL/2.0/');
  assert.ok(typeof json.third_party_notices === 'string' && json.third_party_notices.length > 0);
});

// ── 9. CLAUDE.md 的 @ 导入必须解析到真实存在的 AGENTS.md ──────────────────────
function resolveImport(claudePath) {
  const body = readFileSync(claudePath, 'utf8');
  const line = body.split('\n').find((candidate) => candidate.trim().startsWith('@'));
  assert.ok(line, `${claudePath} 里没有 @ 导入行`);
  const target = join(dirname(claudePath), line.trim().slice(1));
  assert.ok(existsSync(target), `${claudePath} 的导入 ${line.trim()} 解析到不存在的 ${target}`);
  return target;
}
check('project: CLAUDE.md 导入解析到真实 AGENTS.md', () => {
  assert.equal(resolveImport(join(project, 'CLAUDE.md')), join(project, 'AGENTS.md'));
});

run(['init', '--yes', '--claude']);
check('user+--claude: 导入解析到 ~/.agents/AGENTS.md', () => {
  assert.equal(resolveImport(join(fakeHome, '.claude', 'CLAUDE.md')), join(fakeHome, '.agents', 'AGENTS.md'));
});
check('user+--claude: 不生成 .dsh', () => assert.ok(!existsSync(join(fakeHome, '.dsh'))));

// ── 10. --skills filter and doctor ──────────────────────────────────────────
const filtered = join(sandbox, 'filtered');
run(['init', filtered, '--yes', '--scope', 'project', '--accept-mpl-notice', '--skills', 'nope']);
check('--skills 过滤：未选中的包不安装', () => assert.ok(!existsSync(join(filtered, '.agents', 'skills', 'perf-regression-triage'))));
check('--skills 过滤：文档仍然写入', () => assert.ok(existsSync(join(filtered, 'AGENTS.md'))));
check('doctor 可运行', () => assert.ok(run(['doctor', project]).includes('agentscaffold doctor')));

// ── 11. 进度条不得超出终端宽度（曾因折行导致每帧新起一行）────────────────────
const { buildProgressLine, createProgress } = await import(new URL('../dist/ui/progress.js', import.meta.url));
const { displayWidth, truncateToWidth, visibleWidth, wrapToWidth } = await import(
  new URL('../dist/ui/width.js', import.meta.url)
);
check('进度：按显示宽度计量（CJK 算 2 格）', () => {
  assert.equal(displayWidth('中文abc'), 7);
});
check('进度：截断不劈开宽字符', () => {
  const out = truncateToWidth('中文标签abc', 5);
  assert.equal(displayWidth(out), 5);
  assert.ok(out.endsWith('…'), out);
});
check('进度：任何终端宽度下都不超出（不折行）', () => {
  const label = '/very/long/agentscaffold/path/'.repeat(4) + '中文标签.md';
  for (const columns of [12, 20, 33, 40, 80, 120, 200]) {
    const line = buildProgressLine(label, 0.42, columns);
    const width = visibleWidth(line);
    assert.ok(width <= columns - 1, `columns=${columns} 时行宽 ${width} > ${columns - 1}，会折行`);
  }
});
check('进度：SGR 转义不计入宽度', () => {
  assert.equal(visibleWidth('\u001b[2mabc\u001b[0m'), 3);
});
check('进度：每帧以 CR 回到行首，帧内不得含 LF', () => {
  const chunks = [];
  const fake = { isTTY: true, columns: 80, write: (chunk) => { chunks.push(chunk); return true; } };
  const bar = createProgress(3, fake);
  bar.tick('a/one.md');
  bar.tick('b/two.md');
  bar.finish();
  assert.equal(chunks.length, 3, `应有 3 次写入，实际 ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.startsWith('\r'), `帧未以 CR 开头（会新起一行）: ${JSON.stringify(chunk)}`);
    assert.ok(!chunk.includes('\n'), `帧内出现 LF（会新起一行）: ${JSON.stringify(chunk)}`);
  }
});
check('进度：路径类标签保留尾部（文件名可见）', () => {
  const line = buildProgressLine('.agents/skills/perf-regression-triage/THIRD-PARTY-NOTICES.md', 0.9, 60);
  assert.ok(line.includes('THIRD-PARTY-NOTICES.md'), line);
  assert.ok(!line.includes('.agents/skills/perf'), line);
});

// ── 12. note 文案预折行（clack 的 hard wrap 会把词劈开）──────────────────────
const NOTE_TEXT =
  '用户级（推荐）：~/.agents/skills，不写任何仓库\n项目级：<project>/.agents/skills，随项目提交，需确认许可';
check('折行：任意宽度下每行不超预算，且不丢字', () => {
  for (const width of [16, 24, 32, 48, 76]) {
    const wrapped = wrapToWidth(NOTE_TEXT, width);
    for (const line of wrapped.split('\n')) {
      assert.ok(displayWidth(line) <= width, `width=${width} 出现 ${displayWidth(line)} 格的行: ${line}`);
    }
    assert.equal(wrapped.replace(/\n/g, ''), NOTE_TEXT.replace(/\n/g, ''), `width=${width} 折行丢了字`);
  }
});
check('折行：在分句处断，标点留在上一行', () => {
  const lines = wrapToWidth('项目级：<project>/.agents/skills，随项目提交，需确认许可', 40).split('\n');
  assert.ok(lines.length >= 2, lines.join('|'));
  assert.ok(lines[0].endsWith('，'), lines[0]);
});
check('折行：超长不可断的词被切开而不是溢出', () => {
  assert.deepEqual(
    wrapToWidth('a'.repeat(30), 10).split('\n').map((line) => line.length),
    [10, 10, 10],
  );
});
check('折行：保留词间空格且不在行尾留空格', () => {
  const lines = wrapToWidth('alpha beta gamma delta', 11).split('\n');
  assert.ok(lines.every((line) => displayWidth(line) <= 11), lines.join('|'));
  assert.equal(lines.join(' '), 'alpha beta gamma delta');
  assert.ok(!lines.some((line) => line !== line.trimEnd()), '行尾不应有空格');
});

// ── report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const [ok, name] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
}
console.log(`\n${checks.length - failed}/${checks.length} 通过`);
rmSync(sandbox, { recursive: true, force: true });
process.exitCode = failed === 0 ? 0 : 1;

// End-to-end smoke test. Never touches the real HOME: user-scope runs get a fake HOME.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// ── 13. 安装清单与一键卸载 ──────────────────────────────────────────────────
const gitEnv = {
  ...process.env,
  HOME: fakeHome,
  AGENTSCAFFOLD_NO_TUI: '1',
  NO_COLOR: '1',
  GIT_AUTHOR_NAME: 'smoke',
  GIT_AUTHOR_EMAIL: 'smoke@example.com',
  GIT_COMMITTER_NAME: 'smoke',
  GIT_COMMITTER_EMAIL: 'smoke@example.com',
};
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv });
}
/** Tolerant variant: returns '' instead of throwing when git exits non-zero. */
function gitTry(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}
function runIn(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: gitEnv });
}
function failIn(args, cwd) {
  try {
    execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: gitEnv });
    return { code: 0, output: '' };
  } catch (error) {
    return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}
const manifestOf = (root) => JSON.parse(readFileSync(join(root, '.agents', 'agentscaffold.manifest.json'), 'utf8'));

// Isolation: earlier sections installed into the fake HOME, and scope detection would then find
// two installs. Start this section with a clean user scope.
rmSync(join(fakeHome, '.agents'), { recursive: true, force: true });

const repoA = join(sandbox, 'unin-a');
mkdirSync(repoA, { recursive: true });
writeFileSync(join(repoA, 'keep.txt'), 'mine\n');
runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], repoA);

check('清单：init 写出安装清单（schema/scope/哈希）', () => {
  const manifest = manifestOf(repoA);
  assert.equal(manifest.schema, 'agentscaffold/manifest@1');
  assert.equal(manifest.scope, 'project');
  assert.ok(manifest.entries.length >= 16, `条目 ${manifest.entries.length}`);
  assert.ok(manifest.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
  assert.ok(!manifest.entries.some((entry) => entry.path === 'keep.txt'), '不应把用户既有文件记入清单');
});

runIn(['uninstall', '.', '--yes', '--scope', 'project'], repoA);
check('卸载：清单内文件删净、清单自身删除、空目录清理', () => {
  assert.ok(!existsSync(join(repoA, 'AGENTS.md')));
  assert.ok(!existsSync(join(repoA, '.agents', 'skills')));
  assert.ok(!existsSync(join(repoA, '.agents', 'agentscaffold.manifest.json')));
  assert.ok(!existsSync(join(repoA, '.agents')), '空目录 .agents 应被清理');
});
check('卸载：非清单文件与用户既有文件保留', () => assert.ok(existsSync(join(repoA, 'keep.txt'))));

const repoB = join(sandbox, 'unin-b');
mkdirSync(repoB, { recursive: true });
runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], repoB);
const editedFile = join(repoB, '.agents', 'skills', 'perf-regression-triage', 'SKILL.md');
writeFileSync(editedFile, `${readFileSync(editedFile, 'utf8')}\n我改过\n`);
const firstUninstall = runIn(['uninstall', '.', '--yes', '--scope', 'project'], repoB);
check('卸载：安装后被修改的文件默认保留，并保留清单以便后续处理', () => {
  assert.ok(existsSync(editedFile), '被改过的文件不应被删');
  assert.ok(firstUninstall.includes('kept: 安装后被修改'));
  const manifest = manifestOf(repoB);
  assert.deepEqual(
    manifest.entries.map((entry) => entry.path),
    ['.agents/skills/perf-regression-triage/SKILL.md'],
  );
});
runIn(['uninstall', '.', '--yes', '--force', '--scope', 'project'], repoB);
check('卸载 --force：连改过的文件一并删除并清理干净', () => {
  assert.ok(!existsSync(editedFile));
  assert.ok(!existsSync(join(repoB, '.agents')));
});

const emptyRepo = join(sandbox, 'unin-empty');
mkdirSync(emptyRepo, { recursive: true });
check('卸载：没有安装清单时报错退出 2 且不删任何东西', () => {
  writeFileSync(join(emptyRepo, 'x.txt'), 'x');
  const result = failIn(['uninstall', '.', '--yes'], emptyRepo);
  assert.equal(result.code, 2);
  assert.ok(result.output.includes('未发现由 agentscaffold 安装的内容'));
  assert.ok(existsSync(join(emptyRepo, 'x.txt')));
});

const dualRepo = join(sandbox, 'unin-dual');
mkdirSync(dualRepo, { recursive: true });
runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], dualRepo);
runIn(['init', '--yes'], dualRepo); // 用户级装进假 HOME
check('卸载：两个作用域都在 + 非交互未指定 --scope → 报错并列出可选', () => {
  const result = failIn(['uninstall', '.', '--yes'], dualRepo);
  assert.equal(result.code, 2);
  assert.ok(result.output.includes('发现多个安装'), result.output);
});
check('卸载 --scope user：只动用户级', () => {
  runIn(['uninstall', '.', '--yes', '--scope', 'user'], dualRepo);
  assert.ok(!existsSync(join(fakeHome, '.agents', 'skills')));
  assert.ok(existsSync(join(dualRepo, '.agents', 'skills')), '项目级不应被波及');
});

const dryRepo = join(sandbox, 'unin-dry');
mkdirSync(dryRepo, { recursive: true });
runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], dryRepo);
check('卸载 --dry-run：报告但不落盘', () => {
  const output = runIn(['uninstall', '.', '--yes', '--dry-run', '--scope', 'project'], dryRepo);
  assert.ok(output.includes('[removed]'), output);
  assert.ok(existsSync(join(dryRepo, 'AGENTS.md')));
  assert.ok(existsSync(join(dryRepo, '.agents', 'agentscaffold.manifest.json')));
});

// ── 14. 代提交（只提交本次路径，不 push）────────────────────────────────────
const commitRepo = join(sandbox, 'commit-a');
mkdirSync(commitRepo, { recursive: true });
git(['init', '-q', '-b', 'main'], commitRepo);
writeFileSync(join(commitRepo, 'unrelated.txt'), 'staged on purpose\n');
writeFileSync(join(commitRepo, 'other.txt'), 'not ours\n');
git(['add', 'unrelated.txt'], commitRepo); // 故意先暂存一个无关文件

check('代提交：init --commit 生成一个提交，且只含本次路径', () => {
  runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice', '--commit'], commitRepo);
  const subject = git(['log', '-1', '--pretty=%s'], commitRepo).trim();
  assert.ok(subject.startsWith('chore:'), subject);
  const files = git(['show', '--name-only', '--pretty=format:', 'HEAD'], commitRepo).trim().split('\n');
  assert.ok(files.includes('AGENTS.md'), 'AGENTS.md 应在提交里');
  assert.ok(files.includes('.agents/agentscaffold.manifest.json'), '清单应在提交里');
  assert.ok(!files.includes('unrelated.txt'), '无关文件不应被提交');
  assert.ok(!files.includes('other.txt'), '无关文件不应被提交');
});
check('代提交：不 push（没有远程、分支不领先 origin）', () => {
  assert.equal(git(['remote'], commitRepo).trim(), '');
  assert.ok(git(['status', '--porcelain', '--', 'unrelated.txt'], commitRepo).trim() !== '', '无关文件应仍留在暂存区');
});
check('代提交：非交互不加 --commit 就不提交', () => {
  const repo = join(sandbox, 'commit-b');
  mkdirSync(repo, { recursive: true });
  git(['init', '-q', '-b', 'main'], repo);
  const output = runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], repo);
  assert.ok(output.includes('未加 --commit，跳过提交'), output);
  assert.equal(gitTry(['rev-parse', '--verify', '--quiet', 'HEAD'], repo).trim(), '', '不应产生提交');
});
check('代提交：用户级 init 不触发提交步骤', () => {
  const output = runIn(['init', '--yes'], sandbox);
  assert.ok(!output.includes('已提交'), output);
});
check('代提交：不是 git 仓库时，不加 --commit 不会顺手 git init', () => {
  const repo = join(sandbox, 'commit-nogit-a');
  mkdirSync(repo, { recursive: true });
  const output = runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], repo);
  assert.ok(output.includes('不是 git 仓库且未加 --commit'), output);
  assert.ok(!existsSync(join(repo, '.git')), '不应自作主张初始化仓库');
});
check('代提交：--commit 在非 git 目录会先 git init 再提交', () => {
  const repo = join(sandbox, 'commit-nogit-b');
  mkdirSync(repo, { recursive: true });
  const output = runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice', '--commit'], repo);
  assert.ok(output.includes('含 git init'), output);
  assert.ok(existsSync(join(repo, '.git')), '应已初始化仓库');
  const files = git(['show', '--name-only', '--pretty=format:', 'HEAD'], repo).trim().split('\n');
  assert.ok(files.includes('AGENTS.md'), files.join('|'));
  assert.ok(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim() === 'main', '默认分支应为 main');
  assert.equal(git(['remote'], repo).trim(), '', '不应创建任何远程');
});
check('代提交：缺少 git 身份时给出可照做的提示，并说明仓库已建', () => {
  const repo = join(sandbox, 'commit-noident');
  mkdirSync(repo, { recursive: true });
  const env = { ...gitEnv, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
    delete env[key];
  }
  const output = execFileSync(
    process.execPath,
    [cli, 'init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice', '--commit'],
    { cwd: repo, encoding: 'utf8', env },
  );
  assert.ok(output.includes('git config --global user.name'), output);
  assert.ok(output.includes('git 仓库已初始化'), output);
  assert.ok(existsSync(join(repo, '.git')));
  assert.equal(gitTry(['rev-parse', '--verify', '--quiet', 'HEAD'], repo).trim(), '', '身份缺失时不应产生提交');
});

// ── 15. 可选工具：依赖声明与默认不装 ────────────────────────────────────────
const { probePacks } = await import(new URL('../dist/init/cli-deps.js', import.meta.url));
const { loadPacks } = await import(new URL('../dist/pack/pack.js', import.meta.url));

check('可选工具：随包技能包确实声明了可安装的工具（结构化 installWith）', () => {
  const statuses = probePacks(loadPacks());
  const installable = statuses.filter((status) => status.installWith !== undefined).map((status) => status.name);
  assert.ok(installable.includes('profiler-cli'), installable.join(',') || '(无)');
  assert.ok(
    statuses.some((status) => status.name === 'codegraph' && status.required === false),
    'codegraph 应是可选工具',
  );
  // 没有 installWith 的工具只能是建议
  for (const status of statuses) {
    if (status.installWith !== undefined) continue;
    assert.equal(status.installArgv === undefined || Array.isArray(status.installArgv), true);
  }
});

check('可选工具：非交互且没加 --install-tools 时不安装', () => {
  const repo = join(sandbox, 'tools-a');
  mkdirSync(repo, { recursive: true });
  const output = runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], repo);
  assert.ok(!output.includes('可选工具安装结束'), output);
  assert.ok(output.includes('index.ts') || output.includes('install'), '报告里仍应给出建议的安装命令');
});

// ── 16. 附加技能包（optional: true）─────────────────────────────────────────
const addRepo = join(sandbox, 'addon-default');
mkdirSync(addRepo, { recursive: true });
runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], addRepo);

check('附加包：默认不装', () => {
  assert.ok(existsSync(join(addRepo, '.agents', 'skills', 'perf-regression-triage')));
  assert.ok(!existsSync(join(addRepo, '.agents', 'skills', 'profile-analysis')));
});

check('附加包：清单里确实有 optional 包，且默认包没被标 optional', () => {
  const packs = loadPacks();
  assert.deepEqual(
    packs.filter((pack) => pack.optional === true).map((pack) => pack.name),
    ['profile-analysis'],
  );
  assert.ok(packs.some((pack) => pack.name === 'perf-regression-triage' && pack.optional !== true));
});

const addRepo2 = join(sandbox, 'addon-explicit');
mkdirSync(addRepo2, { recursive: true });
runIn(
  ['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice', '--add-packs', 'profile-analysis'],
  addRepo2,
);

check('附加包：--add-packs 才装，并带上自己的 MIT 声明', () => {
  const dir = join(addRepo2, '.agents', 'skills', 'profile-analysis');
  assert.ok(existsSync(join(dir, 'SKILL.md')));
  assert.ok(existsSync(join(dir, 'LICENSE-MIT')));
  assert.ok(!existsSync(join(dir, 'LICENSE-MPL-2.0')), 'MIT 包不该带 MPL 许可文件');
});

check('附加包：清单记录追加包，卸载一并清干净', () => {
  const manifest = manifestOf(addRepo2);
  assert.ok(manifest.packs.includes('profile-analysis'), manifest.packs.join(','));
  runIn(['uninstall', '.', '--yes', '--scope', 'project'], addRepo2);
  assert.ok(!existsSync(join(addRepo2, '.agents')), '附加包的文件与目录也应清干净');
});

check('附加包：--skills 显式点名也能装（不必走 --add-packs）', () => {
  const repo = join(sandbox, 'addon-skills');
  mkdirSync(repo, { recursive: true });
  runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice', '--skills', 'profile-analysis'], repo);
  assert.ok(existsSync(join(repo, '.agents', 'skills', 'profile-analysis')));
  assert.ok(!existsSync(join(repo, '.agents', 'skills', 'perf-regression-triage')), '点名附加包时默认包不应被装上');
});

check('许可：MIT 附加包的文件不计入 mpl_files', () => {
  const report = JSON.parse(run(['--license', '--json']));
  assert.ok(!report.mpl_files.some((file) => file.includes('profile-analysis')));
});

// ── 17. 检索（本地后端：ripgrep 始终可用，codegraph 可选加速）────────────────
const sampleSrc = join(root, 'scripts', 'fixtures', 'sample-project');
const sample = join(sandbox, 'sample-project');
mkdirSync(join(sample, 'src'), { recursive: true });
for (const file of ['greeter.ts', 'caller.ts']) {
  writeFileSync(join(sample, 'src', file), readFileSync(join(sampleSrc, 'src', file)));
}
const plain = join(sandbox, 'plain-project');
mkdirSync(plain, { recursive: true });
writeFileSync(join(plain, 'notes.md'), '# hello\n\nAudioSink is mentioned here.\n');

const { spawnSync } = await import('node:child_process');
const codegraphReady = spawnSync('codegraph', ['--version'], { encoding: 'utf8' }).status === 0;

function searchRaw(args, cwd) {
  try {
    const output = execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, HOME: fakeHome, AGENTSCAFFOLD_NO_TUI: '1', NO_COLOR: '1' },
    });
    return { code: 0, output };
  } catch (error) {
    return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

check('检索：不带参数且非交互时输出 help，不会卡在提示符', () => {
  const output = run([]);
  assert.ok(output.includes('Usage:'), output.slice(0, 200));
  assert.ok(output.includes('search'), 'help 里应列出 search 命令');
});

check('检索：文本检索在没有索引的目录里也能用（无外部依赖）', () => {
  const { code, output } = searchRaw(['search', 'AudioSink', '--kind', 'text', '--path', plain], plain);
  assert.equal(code, 0, output);
  assert.ok(output.includes('notes.md'), output);
  assert.ok(output.includes('AudioSink is mentioned here'), output);
});

check('检索：文本检索支持路径/扩展名限制', () => {
  const hit = searchRaw(['search', 'Audio', '--kind', 'text', '--glob', '**/*.md', '--path', plain], plain);
  assert.equal(hit.code, 0, hit.output);
  const miss = searchRaw(['search', 'Audio', '--kind', 'text', '--glob', '**/*.rs', '--path', plain], plain);
  assert.equal(miss.code, 1, miss.output);
  assert.ok(miss.output.includes('没有匹配'), miss.output);
});

check('检索：需要索引的查询在没有索引时明确说明，不静默失败', () => {
  const { code, output } = searchRaw(['search', 'FriendlyGreeter', '--kind', 'id', '--path', plain], plain);
  assert.equal(code, 2, output);
  assert.ok(output.includes('codegraph'), output);
  assert.ok(output.includes('codegraph init'), '必须给出建索引命令');
  assert.ok(output.includes('--kind text'), '必须给出可用的退路');
});

check('检索：--json 给出后端与是否缺索引', () => {
  const { output } = searchRaw(['search', 'AudioSink', '--kind', 'text', '--json', '--path', plain], plain);
  const report = JSON.parse(output);
  assert.equal(report.tool, 'agentscaffold');
  assert.ok(['ripgrep', 'grep'].includes(report.backends.text), JSON.stringify(report.backends));
  assert.equal(report.kind, 'text');
  assert.ok(report.hits >= 1, output);
});

check('检索：--kind 非法时报错退出 2', () => {
  const { code, output } = searchRaw(['search', 'x', '--kind', 'nope', '--path', plain], plain);
  assert.equal(code, 2, output);
  assert.ok(output.includes('未知的检索类型'), output);
});

check('依赖：codegraph 作为可选工具出现在依赖表里，并写明退路', () => {
  const statuses = probePacks(loadPacks());
  const codegraph = statuses.find((status) => status.name === 'codegraph');
  assert.ok(codegraph !== undefined, 'codegraph 应出现在依赖表');
  assert.equal(codegraph.required, false, 'codegraph 必须是可选的');
  assert.ok(
    (codegraph.fallback ?? '').includes('--kind text'),
    `必须写明不装也能用的退路，实际：${codegraph.fallback}`,
  );
});

if (codegraphReady) {
  spawnSync('codegraph', ['init', sample], { encoding: 'utf8', timeout: 180_000 });

  check('检索：有索引时标识符检索命中（codegraph 后端）', () => {
    const { code, output } = searchRaw(['search', 'FriendlyGreeter', '--kind', 'id'], sample);
    assert.equal(code, 0, output);
    assert.ok(output.includes('FriendlyGreeter'), output);
    assert.ok(output.includes('greeter.ts'), output);
  });

  check('检索：--define 给出完整定义正文而非一行上下文', () => {
    const { code, output } = searchRaw(['search', 'FriendlyGreeter', '--kind', 'define'], sample);
    assert.equal(code, 0, output);
    assert.ok(output.includes('greet(name: string)'), `定义正文应含方法体，实际：\n${output}`);
    assert.ok(output.includes('## 定义'), output);
  });

  check('检索：调用关系走 codegraph', () => {
    const { output } = searchRaw(['search', 'greetTwice', '--kind', 'callers'], sample);
    assert.ok(output.includes('## 调用者'), output);
  });
} else {
  check('检索：codegraph 未安装时跳过索引类断言（文本检索已覆盖）', () => assert.ok(true));
}

// ── 18. 机械触发规则（Firefox review-context.toml 的本地重写）────────────────
const ctx = join(sandbox, 'ctx-project');
mkdirSync(join(ctx, 'docs'), { recursive: true });
mkdirSync(join(ctx, 'src'), { recursive: true });
runIn(['init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice'], ctx);
writeFileSync(join(ctx, 'docs', 'webidl.md'), '# WebIDL 实现约定\n\nfoo\n');
writeFileSync(join(ctx, 'docs', 'frontend.md'), '# 前端约定\n\nbar\n');
writeFileSync(join(ctx, 'src', 'a.cpp'), 'int main() { return 0; }\n');

const rulesFile = join(ctx, '.agents', 'context-rules.toml');
// 写法照 Firefox 的 review-context.toml（数组元素是内联表、嵌套数组、注释、裸字符串路径）。
writeFileSync(
  rulesFile,
  `# 冒烟用规则（照 Firefox review-context.toml 的写法）
version = 1
description = "冒烟用规则"

[[rules]]
name = "WebIDL 实现"
description = "同时碰 WebIDL 与 C++ 时读它"
when = { all = [
  { any_file = { ext = [".webidl"] } },
  { any_file = { ext = [".h", ".cpp"] } },
] }
load = [
  { type = "file", path = "docs/webidl.md" },
  { skill = "prompt-placement" },
]

[[rules]]
name = "同一份文档（去重用）"
when = { any_file = { ext = [".cpp"] } }
load = [ { path = "docs/webidl.md" } ]

[[rules]]
name = "只改文档"
when = { all_files = { include = ["docs/*"] } }
load = [ { type = "file", path = "docs/frontend.md" } ]

[[rules]]
name = "前端约定"
when = { any_file = { include = ["src/*"], exclude = ["src/test/*"], ext = [".ts"] } }
load = [ { type = "file", path = "docs/frontend.md" } ]

[[rules]]
name = "不是测试文件"
when = { all = [
  { any_file = { include = ["src/*"] } },
  { not = { any_file = { include = ["**/test/**"] } } },
] }
load = [ "docs/webidl.md" ]

[[rules]]
name = "加载目标不存在"
when = { any_file = { ext = [".cpp"] } }
load = [ { file = "docs/nope.md" } ]
`,
);

check('上下文规则：--check 通过时退出 0', () => {
  const output = runIn(['context', '.', '--check'], ctx);
  assert.ok(output.includes('规则有效'), output);
});

check('上下文规则：未知字段/空 when 会被拒并退出 2', () => {
  const broken = join(sandbox, 'broken-rules.json');
  writeFileSync(
    broken,
    JSON.stringify({ version: 1, rules: [{ name: '坏的', when: { nonsense: true }, load: [{ file: 'x.md' }] }] }),
  );
  const { code, output } = failIn(['context', '.', '--check', '--rules', broken], ctx);
  assert.equal(code, 2, output);
  assert.ok(output.includes('未知字段'), output);
  assert.ok(output.includes('when'), output);
});

check('上下文规则：all + any_file 组合按预期命中，且按扩展名区分', () => {
  const hit = runIn(['context', '.', '--changed', 'dom/x.webidl', 'dom/y.cpp', '--json'], ctx);
  const report = JSON.parse(hit);
  const names = report.matched.map((match) => match.rule);
  assert.ok(names.includes('WebIDL 实现'), names.join(','));
  const miss = JSON.parse(runIn(['context', '.', '--changed', 'dom/x.webidl', '--json'], ctx));
  assert.ok(
    !miss.matched.map((match) => match.rule).includes('WebIDL 实现'),
    '只有 .webidl 时不该命中（all 要求两类同时出现）',
  );
});

check('上下文规则：all_files 用于 patch 形状（只改文档）', () => {
  const report = JSON.parse(runIn(['context', '.', '--changed', 'docs/a.md', 'docs/b.md', '--json'], ctx));
  const names = report.matched.map((match) => match.rule);
  assert.ok(names.includes('只改文档'), names.join(','));
  const mixed = JSON.parse(runIn(['context', '.', '--changed', 'docs/a.md', 'src/a.cpp', '--json'], ctx));
  assert.ok(!mixed.matched.map((match) => match.rule).includes('只改文档'), '混了源码就不该算「只改文档」');
});

check('上下文规则：not 谓词生效', () => {
  const ok = JSON.parse(runIn(['context', '.', '--changed', 'src/main.cpp', '--json'], ctx));
  assert.ok(ok.matched.map((match) => match.rule).includes('不是测试文件'), 'src 下非测试文件应命中');
  const excluded = JSON.parse(runIn(['context', '.', '--changed', 'src/test/main.cpp', '--json'], ctx));
  assert.ok(!excluded.matched.map((match) => match.rule).includes('不是测试文件'), 'not 命中时该规则应被排除');
});

check('上下文规则：include + exclude + ext 三件套（Firefox 前端那条的形状）', () => {
  const hit = JSON.parse(runIn(['context', '.', '--changed', 'src/app.ts', '--json'], ctx));
  assert.ok(hit.matched.map((match) => match.rule).includes('前端约定'), 'src 下的 .ts 应命中');
  const excluded = JSON.parse(runIn(['context', '.', '--changed', 'src/test/app.ts', '--json'], ctx));
  assert.ok(!excluded.matched.map((match) => match.rule).includes('前端约定'), 'exclude 的路径应被排除');
  const wrongExt = JSON.parse(runIn(['context', '.', '--changed', 'src/app.md', '--json'], ctx));
  assert.ok(!wrongExt.matched.map((match) => match.rule).includes('前端约定'), '扩展名不符就不该命中');
});

check('上下文规则：--rules 也可以指向 JSON（迁移期两种格式都认）', () => {
  const jsonRules = join(sandbox, 'rules-as-json.json');
  writeFileSync(
    jsonRules,
    JSON.stringify({
      version: 1,
      rules: [{ name: 'JSON 规则', when: { any_file: { ext: ['.cpp'] } }, load: [{ file: 'docs/webidl.md' }] }],
    }),
  );
  const report = JSON.parse(
    runIn(['context', '.', '--changed', 'src/a.cpp', '--json', '--rules', jsonRules], ctx),
  );
  assert.ok(report.matched.map((match) => match.rule).includes('JSON 规则'), JSON.stringify(report.matched));
});

check('上下文规则：同一份文件被多条规则加载时全局去重', () => {
  const report = JSON.parse(runIn(['context', '.', '--changed', 'src/a.cpp', '--json'], ctx));
  const count = report.load.filter((path) => path === 'docs/webidl.md').length;
  assert.equal(count, 1, `docs/webidl.md 应只出现一次，实际 ${count}：${report.load.join(',')}`);
});

check('上下文规则：技能名会解析成已安装的 SKILL.md 并带上摘要', () => {
  const report = JSON.parse(runIn(['context', '.', '--changed', 'x.webidl', 'y.cpp', '--json'], ctx));
  const skill = report.matched
    .find((match) => match.rule === 'WebIDL 实现')
    .load.find((item) => item.kind === 'skill');
  assert.ok(skill !== undefined, JSON.stringify(report.matched));
  assert.equal(skill.exists, true, JSON.stringify(skill));
  assert.ok(skill.path.endsWith('prompt-placement/SKILL.md'), skill.path);
  assert.ok((skill.summary ?? '').length > 0, '技能摘要应来自 frontmatter');
});

function captureIn(args, cwd) {
  try {
    const output = execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: gitEnv });
    return { code: 0, output };
  } catch (error) {
    return { code: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

check('上下文规则：load 目标缺失只警告、不致命（对齐 Firefox 的处理）', () => {
  const { code, output } = captureIn(['context', '.', '--changed', 'src/a.cpp'], ctx);
  assert.equal(code, 0, output);
  assert.ok(output.includes('docs/nope.md'), `应报告缺失的加载目标，实际：\n${output}`);
  assert.ok(output.includes('不存在'), output);
});

check('上下文规则：apply 后输出可读的「该读什么」并说明注入顺序', () => {
  const output = runIn(['context', '.', '--changed', 'dom/x.webidl', 'dom/y.cpp'], ctx);
  assert.ok(output.includes('# 本次改动的上下文'), output);
  assert.ok(output.includes('为什么：'), output);
  assert.ok(output.includes('放在 diff 之前'), output);
});

check('上下文规则：--list 列出规则与判据', () => {
  const output = runIn(['context', '.', '--list'], ctx);
  assert.ok(output.includes('WebIDL 实现'), output);
  assert.ok(output.includes('至少一个改动文件'), output);
  assert.ok(output.includes('扩展名 .webidl'), output);
});

check('上下文规则：没有规则文件时退出 1 并给出生成命令', () => {
  const empty = join(sandbox, 'ctx-empty');
  mkdirSync(empty, { recursive: true });
  const { code, output } = failIn(['context', '.'], empty);
  assert.equal(code, 1, output);
  assert.ok(output.includes('context --init'), output);
});

check('上下文规则：--init 生成模板且不覆盖已有文件', () => {
  const fresh = join(sandbox, 'ctx-fresh');
  mkdirSync(fresh, { recursive: true });
  const first = runIn(['context', '.', '--init'], fresh);
  assert.ok(first.includes('已创建'), first);
  assert.ok(existsSync(join(fresh, '.agents', 'context-rules.toml')));
  const second = failIn(['context', '.', '--init'], fresh);
  assert.equal(second.code, 1, second.output);
  assert.ok(second.output.includes('已存在'), second.output);
});

check('上下文规则：--since <ref> 从 git 取改动文件', () => {
  const repo = join(sandbox, 'ctx-git');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  mkdirSync(join(repo, '.agents'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'context-rules.toml'), readFileSync(rulesFile));
  gitTry(['init', '-q'], repo);
  writeFileSync(join(repo, 'docs', 'frontend.md'), 'one\n');
  gitTry(['add', '-A'], repo);
  gitTry(['commit', '-qm', 'init'], repo);
  writeFileSync(join(repo, 'docs', 'frontend.md'), 'two\n');
  const output = runIn(['context', '.', '--since', 'HEAD', '--json'], repo);
  const report = JSON.parse(output);
  assert.deepEqual(report.changed, ['docs/frontend.md']);
  assert.equal(report.changed_source, 'git diff --name-only HEAD');
  const ranged = JSON.parse(runIn(['context', '.', '--range', 'HEAD...HEAD', '--json'], repo));
  assert.deepEqual(ranged.changed, [], '三点比较到自己应得到空集');
  assert.equal(ranged.changed_source, 'git diff --name-only HEAD...HEAD');
});

// ── 19. 可选工具：隔离安装到自用前缀（不碰系统全局）────────────────────────
const {
  isolatedArgv,
  installableMissing,
  advisoryOnly,
  canInstall,
  listInstalled,
} = await import(new URL('../dist/init/tool-install.js', import.meta.url));
const stubManager = join(root, 'scripts', 'fixtures', 'fake-manager.sh');
const fakeTools = join(sandbox, 'tools-prefix');
const managerLog = join(sandbox, 'manager.log');
const toolEnv = {
  ...process.env,
  HOME: fakeHome,
  AGENTSCAFFOLD_NO_TUI: '1',
  NO_COLOR: '1',
  AGENTSCAFFOLD_TOOLS_DIR: fakeTools,
  AGENTSCAFFOLD_NPM: stubManager,
  AGENTSCAFFOLD_CARGO: stubManager,
  FAKE_MANAGER_LOG: managerLog,
};
const fakeStatus = (over) => ({ name: 'demo', required: false, found: false, versionOk: false, usedBy: [], ...over });

check('可选工具：npm 走 --prefix、cargo 走 --root，从不带 -g', () => {
  const npm = isolatedArgv({ name: 'x', manager: 'npm', package: '@scope/pkg' }, '/tmp/p').join(' ');
  const cargo = isolatedArgv({ name: 'y', manager: 'cargo', package: 'crate' }, '/tmp/p').join(' ');
  assert.ok(npm.includes('--prefix /tmp/p'), npm);
  assert.ok(!npm.includes(' -g'), `绝不能全局安装：${npm}`);
  assert.ok(cargo.includes('--root /tmp/p'), cargo);
  assert.ok(cargo.includes('--locked'), cargo);
});

check('可选工具：只挑声明了 installWith 的；裸 argv 只算建议、不执行', () => {
  const statuses = [
    fakeStatus({ name: 'structured', installWith: { manager: 'npm', package: 'p' } }),
    fakeStatus({ name: 'raw-argv-only', installArgv: ['npm', 'install', '-g', 'p'] }),
    fakeStatus({ name: 'installed', found: true, installWith: { manager: 'npm', package: 'p' } }),
    fakeStatus({ name: 'pip-only' }),
  ];
  assert.deepEqual(installableMissing(statuses).map((s) => s.name), ['structured']);
  assert.deepEqual(advisoryOnly(statuses).map((s) => s.name), ['raw-argv-only', 'pip-only']);
});

check('可选工具：管理器缺失时前置检查就拦下，不跑也不留记录', () => {
  const previous = process.env.AGENTSCAFFOLD_NPM;
  process.env.AGENTSCAFFOLD_NPM = join(sandbox, 'no-such-manager');
  // canInstall 收的是 InstallTarget（name/manager/package），不是带 installWith 的 ToolStatus。
  const verdict = canInstall({ name: 'x', manager: 'npm', package: 'p' }, fakeTools);
  if (previous === undefined) delete process.env.AGENTSCAFFOLD_NPM;
  else process.env.AGENTSCAFFOLD_NPM = previous;
  assert.equal(verdict.ok, false, '找不到管理器就该拒绝执行');
  assert.ok(
    (verdict.reason ?? '').includes('no-such-manager') || (verdict.reason ?? '').includes('找不到'),
    verdict.reason,
  );
});

check('可选工具：装进自用前缀并留下可撤销的记录（端到端，桩管理器）', () => {
  rmSync(fakeTools, { recursive: true, force: true });
  rmSync(managerLog, { force: true });
  const repo = join(sandbox, 'tools-project');
  mkdirSync(repo, { recursive: true });
  const output = execFileSync(
    process.execPath,
    [cli, 'init', '.', '--yes', '--scope', 'project', '--accept-mpl-notice', '--install-tools'],
    { cwd: repo, encoding: 'utf8', env: toolEnv },
  );
  assert.ok(output.includes('已安装'), output);
  assert.ok(output.includes(fakeTools), `必须说明装到自用前缀：\n${output}`);
  const log = readFileSync(managerLog, 'utf8');
  // 权威证据：真正执行的命令里绝不能出现 -g（报告里给人看的建议文案不算）。
  assert.ok(log.includes(`--prefix ${fakeTools}`), log);
  assert.ok(!/\s-g\s/.test(log), `执行的命令里不该有 -g：\n${log}`);
  const records = listInstalled(fakeTools);
  assert.ok(records.length >= 1, JSON.stringify(records));
  assert.ok(
    records.every((record) => record.argv.includes('--prefix') || record.argv.includes('--root')),
    JSON.stringify(records),
  );
});

check('可选工具：PATH 不在时给出加 PATH 的一行；能列出与撤销', () => {
  const listed = execFileSync(process.execPath, [cli, 'tools'], { encoding: 'utf8', env: toolEnv });
  assert.ok(listed.includes('export PATH='), listed);
  assert.ok(listed.includes('已装'), listed);

  const removed = execFileSync(process.execPath, [cli, 'tools', '--remove', listInstalled(fakeTools)[0].name], {
    encoding: 'utf8',
    env: toolEnv,
  });
  assert.ok(removed.includes('已移除'), removed);

  const all = execFileSync(process.execPath, [cli, 'tools', '--remove-all'], { encoding: 'utf8', env: toolEnv });
  assert.ok(all.includes('已撤销'), all);
  assert.ok(!existsSync(fakeTools), '撤销全部后目录应被删掉');
});

check('可选工具：用户级卸载时把我们自装的工具一并撤销', () => {
  rmSync(fakeTools, { recursive: true, force: true });
  mkdirSync(join(fakeTools, 'bin'), { recursive: true });
  writeFileSync(
    join(fakeTools, 'installed.json'),
    JSON.stringify({
      tool: 'agentscaffold',
      prefix: fakeTools,
      installed: [
        {
          name: 'demo',
          manager: 'npm',
          package: 'demo',
          argv: ['npm', 'install', '--prefix', fakeTools, 'demo'],
          installedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  runIn(['init', '--yes'], sandbox);
  const output = execFileSync(process.execPath, [cli, 'uninstall', '--yes', '--scope', 'user'], {
    encoding: 'utf8',
    env: toolEnv,
  });
  assert.ok(output.includes('已撤销'), output);
  assert.ok(!existsSync(fakeTools), '工具前缀应随之删除');
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

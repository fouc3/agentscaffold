/**
 * Code retrieval backends — the local, reusable take on searchfox-cli's idea.
 *
 * searchfox-cli (https://github.com/padenot/searchfox-cli) is a CLI written for AI agents that
 * answers "where is this defined / who calls it" against Mozilla's hosted Searchfox index. We
 * borrow the *shape* of that tool — symbol/definition/call-graph queries with markdown output —
 * but not its dependency: it needs network access and only indexes Mozilla's trees.
 *
 * So there are two local backends, and neither is required:
 *
 *   codegraph  optional accelerator. Gives real symbols, definitions (line ranges) and call
 *              graphs, but only for a project that was indexed (`codegraph init`).
 *   ripgrep    always-available text search. Falls back to `grep -rnF` when rg is missing.
 *
 * Anything that needs the index says so explicitly instead of returning a wrong answer, and
 * nothing here ever installs or indexes anything on its own.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export type BackendName = 'codegraph' | 'ripgrep' | 'grep';

export interface BackendState {
  codegraph: { available: boolean; version?: string; indexed: boolean };
  text: { backend: BackendName; version?: string };
}

export function codegraphBinary(): string {
  const override = process.env.AGENTSCAFFOLD_CODEGRAPH;
  return override !== undefined && override.length > 0 ? override : 'codegraph';
}

export const CODEGRAPH_INSTALL = 'npm install -g @colbymchenry/codegraph';
/** Isolatable form: we install it into our own prefix, never globally. */
export const CODEGRAPH_INSTALL_WITH = { manager: 'npm', package: '@colbymchenry/codegraph' } as const;

function probe(bin: string, args = ['--version']): string | undefined {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 10_000 });
  if (result.error !== undefined && result.error !== null) return undefined;
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return text.length > 0 ? text.split('\n')[0]?.trim() : 'ok';
}

/** Is this project indexed? Presence of the index dir is the only reliable signal. */
export function indexReady(dir: string): boolean {
  return existsSync(join(dir, '.codegraph'));
}

export function detectBackends(dir: string): BackendState {
  const version = probe(codegraphBinary());
  const rg = probe('rg');
  return {
    codegraph: { available: version !== undefined, version, indexed: version !== undefined && indexReady(dir) },
    text: rg !== undefined ? { backend: 'ripgrep', version: rg } : { backend: 'grep', version: probe('grep') },
  };
}

/** Async so a spinner keeps animating; codegraph on a big repo is not instant. */
async function run(bin: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<{ ok: boolean; output: string; error?: string }> {
  return await new Promise((resolve_) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve_({ ok: false, output, error: '超时' });
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve_({ ok: false, output, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve_({ ok: code === 0, output, error: code === 0 ? undefined : '非零退出码' });
    });
  });
}

export interface SymbolHit {
  name: string;
  qualifiedName: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
  language?: string;
  exported?: boolean;
  score?: number;
}

export async function querySymbols(dir: string, query: string, limit: number): Promise<SymbolHit[]> {
  const result = await run(codegraphBinary(), ['query', query, '-j', '-l', String(limit)], dir);
  if (!result.ok) return [];
  const start = result.output.indexOf('[');
  if (start < 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.output.slice(start));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => (item as { node?: Record<string, unknown>; score?: number }).node)
    .filter((node): node is Record<string, unknown> => node !== undefined)
    .map((node) => ({
      name: String(node.name ?? ''),
      qualifiedName: String(node.qualifiedName ?? node.name ?? ''),
      kind: String(node.kind ?? ''),
      file: String(node.filePath ?? ''),
      startLine: Number(node.startLine ?? 0),
      endLine: Number(node.endLine ?? 0),
      language: node.language === undefined ? undefined : String(node.language),
      exported: node.isExported === true,
      score: undefined,
    }));
}

/** Call graph / impact queries: codegraph prints a human table, we pass it through. */
export async function callGraph(
  dir: string,
  mode: 'callers' | 'callees' | 'impact',
  symbol: string,
): Promise<{ ok: boolean; output: string; error?: string }> {
  const result = await run(codegraphBinary(), [mode, symbol], dir);
  return { ok: result.ok, output: result.output, error: result.error };
}

export interface TextHit {
  file: string;
  line: number;
  text: string;
}

export interface TextOptions {
  pathGlob?: string;
  extensions?: string[];
  limit: number;
}

/** Text search that always works: rg when present, `grep -rnF` otherwise. */
export function textBinary(): { binary: string; label: BackendName } {
  return probe('rg') !== undefined ? { binary: 'rg', label: 'ripgrep' } : { binary: 'grep', label: 'grep' };
}

export async function textSearch(dir: string, query: string, options: TextOptions): Promise<TextHit[]> {
  const { binary, label } = textBinary();
  const args: string[] = [];
  if (label === 'ripgrep') {
    args.push('--line-number', '--no-heading', '--color', 'never', '--fixed-strings', '--max-count', '200');
    if (options.pathGlob !== undefined) args.push('--glob', options.pathGlob);
    for (const ext of options.extensions ?? []) args.push('--glob', `*.${ext}`);
    args.push('--', query, '.');
  } else {
    args.push('-rnF', '--', query, '.');
  }

  const result = await run(binary, args, dir, 60_000);
  const hits: TextHit[] = [];
  for (const raw of result.output.split('\n')) {
    const match = /^\.?\/?(.+?):(\d+):(.*)$/.exec(raw.trim());
    if (match === null) continue;
    const file = match[1] ?? '';
    if (options.pathGlob !== undefined && !globMatches(file, options.pathGlob)) continue;
    hits.push({ file, line: Number(match[2] ?? 0), text: (match[3] ?? '').trim() });
    if (hits.length >= options.limit) break;
  }
  return hits;
}

/**
 * Glob match for the post-filter. Must not be stricter than ripgrep's own `--glob`, or the
 * fallback (grep, which cannot filter) and the ripgrep path would disagree:
 *   '**\/*.md' and '*.md' both match 'notes.md' at the root and 'sub/deep.md'.
 */
function globMatches(file: string, glob: string): boolean {
  const toRegex = (pattern: string): string =>
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '\u0001')
      .replace(/\*\*/g, '\u0002')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0001/g, '(?:.*/)?')
      .replace(/\u0002/g, '.*');
  const pattern = toRegex(glob);
  if (glob.includes('/')) return new RegExp(`^(?:.*/)?${pattern}$`).test(file);
  // A bare pattern matches at any depth (ripgrep semantics).
  return new RegExp(`(^|/)${pattern}$`).test(file);
}

/**
 * The `--define` idea: get the *whole* declaration/implementation, not a line of context.
 * With an index we already know the exact line range, so we slice the file ourselves.
 */
export function extractBlock(projectDir: string, file: string, startLine: number, endLine: number, maxLines = 80): string {
  const absolute = isAbsolute(file) ? file : join(resolve(projectDir), file);
  if (!existsSync(absolute)) return '';
  let lines: string[];
  try {
    lines = readFileSync(absolute, 'utf8').split('\n');
  } catch {
    return '';
  }
  const from = Math.max(0, startLine - 1);
  const to = Math.min(lines.length, Math.max(endLine, startLine) + (maxLines > 0 ? 0 : 0));
  const slice = lines.slice(from, Math.min(to, from + maxLines));
  const width = String(from + slice.length).length;
  return slice.map((text, index) => `${String(from + index + 1).padStart(width, ' ')}  ${text}`).join('\n');
}

// ── markdown rendering (the part worth borrowing from searchfox-cli) ─────────

export function renderSymbols(query: string, hits: SymbolHit[], limit: number): string {
  if (hits.length === 0) return `没有匹配「${query}」的符号。`;
  const lines = [`## 标识符「${query}」— ${hits.length} 个符号`, ''];
  for (const hit of hits.slice(0, limit)) {
    const flags = [hit.kind, hit.language, hit.exported === true ? 'exported' : undefined].filter(Boolean).join(' · ');
    lines.push(`- \`${hit.qualifiedName}\` (${flags}) — ${hit.file}:${hit.startLine}-${hit.endLine}`);
  }
  if (hits.length > limit) lines.push(`- …（还有 ${hits.length - limit} 个，用 --limit 调整）`);
  return lines.join('\n');
}

export function renderDefinition(query: string, hit: SymbolHit, body: string): string {
  const lines = [
    `## 定义「${query}」`,
    '',
    `- 命中：\`${hit.qualifiedName}\` (${hit.kind}${hit.language === undefined ? '' : ` · ${hit.language}`})`,
    `- 位置：\`${hit.file}:${hit.startLine}-${hit.endLine}\``,
    '',
    '```' + (hit.language ?? ''),
    body,
    '```',
  ];
  return lines.join('\n');
}

export function renderText(query: string, hits: TextHit[], options: TextOptions): string {
  const scope = [options.pathGlob, ...(options.extensions ?? []).map((ext) => `*.${ext}`)].filter(Boolean).join(' + ');
  if (hits.length === 0) return `没有匹配「${query}」的文本${scope.length > 0 ? `（限制：${scope}）` : ''}。`;
  const byFile = new Map<string, TextHit[]>();
  for (const hit of hits) {
    const list = byFile.get(hit.file) ?? [];
    list.push(hit);
    byFile.set(hit.file, list);
  }
  const lines = [`## 文本「${query}」— ${hits.length} 处${scope.length > 0 ? `（限制：${scope}）` : ''}`, ''];
  for (const [file, list] of byFile) {
    lines.push(`### ${file}`);
    for (const hit of list) lines.push(`- ${hit.line}: ${hit.text.slice(0, 160)}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function renderCallGraph(mode: 'callers' | 'callees' | 'impact', symbol: string, output: string): string {
  const title = mode === 'callers' ? '调用者' : mode === 'callees' ? '被调用者' : '影响面';
  const body = output
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, all) => !(line.trim().length === 0 && (index === 0 || all[index - 1]?.trim().length === 0)))
    .join('\n');
  return [`## ${title}「${symbol}」`, '', '```', body.trim(), '```'].join('\n');
}

/** What to tell the user when an index-only query was asked for without an index. */
export function indexHint(dir: string, state: BackendState): string {
  if (!state.codegraph.available) {
    return [
      '这类查询（标识符 / 定义 / 调用关系 / 影响面）需要 codegraph，它是一个**可选**依赖，当前没装。',
      '',
      `装它：${CODEGRAPH_INSTALL}`,
      `然后给项目建索引：codegraph init ${dir}`,
      '',
      '不装也行：用文本检索，它靠 ripgrep，无需索引。',
      `    agentscaffold search '<关键词>' --kind text`,
    ].join('\n');
  }
  if (!state.codegraph.indexed) {
    return [
      `codegraph 已装（${state.codegraph.version ?? '未知版本'}），但这个项目还没有索引：${dir}/.codegraph 不存在。`,
      '',
      `建索引：codegraph init ${dir}`,
      '',
      `在此之前可以用文本检索：agentscaffold search '<关键词>' --kind text`,
      '',
      '索引建好后，标识符、定义、调用关系才可用。',
    ].join('\n');
  }
  return '';
}

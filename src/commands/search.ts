/**
 * `agentscaffold search` — local code retrieval, plus the 检索 TUI.
 *
 * Bare `agentscaffold` with a real terminal opens the TUI; with no terminal (an agent's bash,
 * a pipe, CI) it prints help instead, because prompting where nothing can answer just looks
 * like a hang.
 *
 * Query shapes follow searchfox-cli's idea (`--define`, `--id`, `--path` + text, call graph),
 * but every backend is local and optional: text search always works, symbol/definition/call
 * graph need codegraph and an index, and we say so instead of guessing.
 */
import { bold, dim, green, red, yellow } from '../ui/color.js';
import { answer, clack, interactive } from '../ui/prompt.js';
import { noteWidth, wrapToWidth } from '../ui/width.js';
import { toolVersion } from '../util/version.js';
import {
  CODEGRAPH_INSTALL,
  callGraph,
  detectBackends,
  extractBlock,
  indexHint,
  querySymbols,
  renderCallGraph,
  renderDefinition,
  renderSymbols,
  renderText,
  textSearch,
  type BackendState,
  type SymbolHit,
} from '../search/code.js';

export type SearchKind = 'define' | 'id' | 'text' | 'callers' | 'callees' | 'impact';

export const SEARCH_KINDS: SearchKind[] = ['define', 'id', 'text', 'callers', 'callees', 'impact'];

const KIND_LABEL: Record<SearchKind, string> = {
  define: '定义 / 实现（完整源码块）',
  id: '标识符（用索引精确查符号）',
  text: '文本（ripgrep，可限路径/扩展名）',
  callers: '谁调用了它',
  callees: '它调用了谁',
  impact: '改它会影响什么',
};

export interface SearchFlags {
  kind?: string;
  query?: string;
  /** Project directory holding the code (and the optional codegraph index). */
  path?: string;
  /** Path glob for text search, e.g. 'src/*' or '*.md'. */
  glob?: string;
  /** Extensions for text search, e.g. `ts,css`. */
  ext?: string;
  limit: number;
  json: boolean;
}

interface Outcome {
  markdown: string;
  hits: number;
  /** True when the query needed an index we do not have. */
  needsIndex: boolean;
}

function parseKind(spec: string | undefined): SearchKind {
  if (spec === undefined || spec.trim().length === 0) return 'text';
  const wanted = spec.trim().toLowerCase();
  if ((SEARCH_KINDS as string[]).includes(wanted)) return wanted as SearchKind;
  throw new Error(`未知的检索类型：${spec}（可选 ${SEARCH_KINDS.join('/')}）`);
}

function extensions(spec: string | undefined): string[] | undefined {
  if (spec === undefined || spec.trim().length === 0) return undefined;
  return spec
    .split(',')
    .map((item) => item.trim().replace(/^\./, ''))
    .filter((item) => item.length > 0);
}

/** Run one query against the best available backend. Never installs or indexes anything. */
export async function runQuery(
  dir: string,
  kind: SearchKind,
  query: string,
  options: { glob?: string; ext?: string; limit: number },
  state: BackendState,
): Promise<Outcome> {
  if (kind === 'text') {
    const hits = await textSearch(dir, query, {
      pathGlob: options.glob,
      extensions: extensions(options.ext),
      limit: options.limit,
    });
    return {
      markdown: renderText(query, hits, { pathGlob: options.glob, extensions: extensions(options.ext), limit: options.limit }),
      hits: hits.length,
      needsIndex: false,
    };
  }

  // Everything below is index-only.
  if (!state.codegraph.available || !state.codegraph.indexed) {
    return { markdown: indexHint(dir, state), hits: 0, needsIndex: true };
  }

  if (kind === 'id' || kind === 'define') {
    const symbols = await querySymbols(dir, query, Math.max(options.limit, 20));
    if (symbols.length === 0) {
      return { markdown: `索引里没有匹配「${query}」的符号。`, hits: 0, needsIndex: false };
    }
    if (kind === 'id') {
      return { markdown: renderSymbols(query, symbols, options.limit), hits: symbols.length, needsIndex: false };
    }
    const best = pickDefinition(symbols, query);
    const body = extractBlock(dir, best.file, best.startLine, best.endLine, 80);
    const header = body.length > 0 ? '' : '（读不到源码文件内容，只给位置）\n\n';
    return { markdown: header + renderDefinition(query, best, body), hits: 1, needsIndex: false };
  }

  const result = await callGraph(dir, kind, query);
  // codegraph exits 0 for "not found", so look at the text too — a bare table would look like
  // "there are no callers", which is a different (and wrong) answer.
  const missing = !result.ok || /not found/i.test(result.output);
  if (missing) {
    const detail = result.output.trim().replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0] ?? '';
    return {
      markdown: [
        `codegraph ${kind} 没找到「${query}」。${detail.length > 0 ? `（${detail}）` : ''}`,
        '',
        `先用 \`agentscaffold search '${query}' --kind id\` 看索引里的准确符号名（可能带命名空间或文件名）。`,
      ].join('\n'),
      hits: 0,
      needsIndex: false,
    };
  }
  return { markdown: renderCallGraph(kind, query, result.output), hits: 1, needsIndex: false };
}

/**
 * `--define` picks the definition, not a mention: prefer a class/struct over a constructor,
 * a function/method over a call site — the same priority searchfox-cli documents.
 */
function pickDefinition(symbols: SymbolHit[], query: string): SymbolHit {
  const priority: Record<string, number> = {
    class: 0,
    struct: 1,
    interface: 2,
    enum: 3,
    function: 4,
    method: 5,
    constructor: 6,
    constant: 7,
    variable: 8,
    file: 9,
  };
  const exact = symbols.filter((hit) => hit.name === query || hit.qualifiedName === query);
  const pool = exact.length > 0 ? exact : symbols;
  return [...pool].sort((a, b) => (priority[a.kind] ?? 50) - (priority[b.kind] ?? 50))[0] as SymbolHit;
}

function backendSummary(state: BackendState, dir: string): string {
  const { backend, version } = state.text;
  // rg prints "ripgrep 15.2.0", grep prints "grep (GNU grep) 3.12" — don't repeat the label.
  const text =
    version === undefined
      ? `文本检索：${backend}`
      : version.toLowerCase().includes(backend)
        ? `文本检索：${version}`
        : `文本检索：${backend} ${version}`;
  const code = state.codegraph.available
    ? `codegraph ${state.codegraph.version ?? '?'}${state.codegraph.indexed ? '（本项目已建索引）' : '（本项目未建索引）'}`
    : `codegraph 未安装（可选；装了才有符号/定义/调用关系，安装：${CODEGRAPH_INSTALL}）`;
  return `${text}\n${code}\n项目目录：${dir}`;
}

/** Non-interactive: one query, markdown or JSON out. */
export async function runSearch(flags: SearchFlags): Promise<number> {
  const dir = flags.path !== undefined && flags.path.length > 0 ? flags.path : process.cwd();
  const state = detectBackends(dir);

  let kind: SearchKind;
  try {
    kind = parseKind(flags.kind);
  } catch (error) {
    process.stderr.write(`${red('错误')}：${(error as Error).message}\n`);
    return 2;
  }
  if (flags.query === undefined || flags.query.length === 0) {
    process.stderr.write(`${red('错误')}：没有要检索的内容。用法：agentscaffold search <关键词> [--kind ...]\n`);
    return 2;
  }

  const outcome = await runQuery(dir, kind, flags.query, { glob: flags.glob, ext: flags.ext, limit: flags.limit }, state);

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          tool: 'agentscaffold',
          query: flags.query,
          kind,
          path: dir,
          backends: {
            text: state.text.backend,
            codegraph: state.codegraph.available ? state.codegraph.version ?? true : false,
            indexed: state.codegraph.indexed,
          },
          needs_index: outcome.needsIndex,
          hits: outcome.hits,
          markdown: outcome.markdown,
        },
        null,
        2,
      )}\n`,
    );
    return outcome.needsIndex ? 2 : outcome.hits === 0 ? 1 : 0;
  }

  process.stdout.write(`${outcome.markdown}\n`);
  if (outcome.needsIndex) {
    process.stderr.write(`${yellow('提示')}：${dim('这类查询需要 codegraph 索引；文本检索随时可用。')}\n`);
    return 2;
  }
  return outcome.hits === 0 ? 1 : 0;
}

export async function runSearchTui(): Promise<number> {
  const dir = process.cwd();
  const state = detectBackends(dir);
  clack.intro(`${bold('agentscaffold')} 检索 ${dim(`v${toolVersion}`)}`);
  clack.note(wrapToWidth(backendSummary(state, dir), noteWidth()), '可用后端');

  const kindOptions: Array<{ value: string; label: string; hint: string }> = SEARCH_KINDS.map((kind) => ({
    value: kind,
    label: KIND_LABEL[kind],
    hint: kind === 'text' ? '无需索引' : '需要索引',
  }));
  kindOptions.push({ value: 'quit', label: '退出', hint: '什么都不改' });

  try {
    for (;;) {
      const kind = answer<string>(
        await clack.select<string>({
          message: '检索类型',
          initialValue: 'id',
          options: kindOptions,
        }),
      );
      if (kind === 'quit') break;

      const query = answer<string>(
        await clack.text({
          message: '检索什么？（符号名、文本片段……）',
          placeholder: kind === 'define' ? '例如 AudioContext::CreateGain' : '例如 AudioSink',
        }),
      );

      let glob: string | undefined;
      if (kind === 'text') {
        const scope = answer<string>(
          await clack.text({ message: '限制路径/扩展名（可留空）', placeholder: '例如 src/** 或 **/*.ts', defaultValue: '' }),
        );
        glob = scope.trim().length > 0 ? scope.trim() : undefined;
      }

      const spinner = clack.spinner();
      spinner.start(`检索「${query}」…`);
      const outcome = await runQuery(dir, kind as SearchKind, query, { glob, limit: 30 }, state);
      spinner.stop(outcome.needsIndex ? '需要索引' : `完成（${outcome.hits} 处）`);

      clack.note(wrapToWidth(outcome.markdown.slice(0, 6000), noteWidth()), `${kind}「${query}」`);
      if (outcome.needsIndex) {
        const init = answer<boolean>(
          await clack.confirm({
            message: '要我给出建索引的命令吗？（本工具不会替你建索引）',
            initialValue: false,
          }),
        );
        if (init) clack.note(`codegraph init ${dir}`, '建索引命令');
      }
    }
    clack.outro(green('检索结束'));
    return 0;
  } catch (error) {
    if ((error as Error).message === 'cancelled') throw error;
    clack.outro(red((error as Error).message));
    return 1;
  }
}

/** Bare `agentscaffold`: 检索 TUI when a human can type, help when nobody can. */
export async function runDefaultAction(printHelp: () => void): Promise<number> {
  if (!interactive()) {
    printHelp();
    return 0;
  }
  return await runSearchTui();
}

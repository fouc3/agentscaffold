/**
 * 机械触发的上下文规则 —— Firefox `review-context.toml`（Review Helper）的本地实现。
 *
 * Firefox 那套解决的是同一个问题：**不让模型猜"要不要读某份资料"**。改动文件一确定，
 * 规则就能机械判定该加载哪些文件/技能，并把内容作为受信任上下文放在 diff 之前。
 *
 * 格式**保持 TOML**：TOML 是通用格式，Firefox 的规则文件可以几乎原样搬过来（只改路径），
 * 这是我们想要的兼容性；JSON 那版曾把这个兼容性换成了"我少写一个解析器"的方便，不划算。
 * 解析用 TOML 1.0 实现（smol-toml），不自己写子集解析器——合法语法上的静默错误代价更大。
 *
 * 与 Firefox 一致的部分：
 *   - `any_file` / `all_files` / `all` / `any` / `not` 谓词组合，`include` / `exclude` / `ext` 文件谓词
 *   - 匹配语义照抄 Python `fnmatchcase`：`*` **也匹配 `/`**（所以 `dom/media/**` 匹配整个前缀）
 *   - `load` 项写 `{ type = "file", path = "..." }`；空/缺的 load 目标只警告不致命
 *   - 多条规则命中时全局去重，同一份内容不会加载两次
 *   - 规则文件可校验（对应 `mach lint review-context.toml`）
 *
 * 刻意不同的部分：
 *   - 输出是"这次该读什么"的清单（markdown/JSON），谁能消费由宿主决定；我们不假设自己
 *     有权注入别人的 prompt（Firefox 有 Review Helper，我们没有）
 *   - `load` 额外支持技能名（`{ skill = "x" }`）与裸字符串路径，省掉手写路径
 *   - 规则文件放在项目里 `.agents/context-rules.toml`，也可用 `--rules` 指向别处
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';

/** 匹配语义：`*` 匹配任意字符（含 `/`），`?` 匹配单字符 —— 与 Python fnmatchcase 一致。 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (const char of pattern) {
    if (char === '*') out += '.*';
    else if (char === '?') out += '.';
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export interface FilePredicate {
  include?: string[];
  exclude?: string[];
  ext?: string[];
}

export type Predicate =
  | { any_file: FilePredicate | Predicate[] }
  | { all_files: FilePredicate | Predicate[] }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

export interface RuleLoad {
  /** Path to a file inside the project (Firefox's `{type:"file", path}` shape). */
  path?: string;
  /** Shorthand for a path. */
  file?: string;
  /** Name of an installed skill; resolved to its SKILL.md. */
  skill?: string;
}

/** `load` entry: Firefox's `{ type = "file", path = "..." }`, plus our two conveniences. */
export type RuleLoadInput = RuleLoad | string;

export interface ContextRule {
  name: string;
  description?: string;
  when: Predicate;
  load: RuleLoadInput[];
  /** Higher runs first in the report; ties keep file order. */
  priority?: number;
}

export interface RulesFile {
  version: number;
  description?: string;
  rules: ContextRule[];
}

export const RULES_RELATIVE_PATH = join('.agents', 'context-rules.toml');

export function rulesPathFor(projectRoot: string, override?: string): string {
  if (override !== undefined && override.length > 0) return resolve(override);
  return join(resolve(projectRoot), RULES_RELATIVE_PATH);
}

/** `{ skill = "x" }` / `{ type = "file", path = "y" }` / `"y"` → one shape. */
export function normalizeLoad(entry: RuleLoadInput): RuleLoad {
  if (typeof entry === 'string') return { file: entry };
  return entry;
}

export interface LoadedRules {
  file: string;
  dir: string;
  rules: RulesFile;
}

/** Read the rules file: TOML by default (Firefox-compatible), JSON when asked by extension. */
export function readRules(file: string): LoadedRules | undefined {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  const parsed = (file.endsWith('.json') ? JSON.parse(text) : parseToml(text)) as RulesFile;
  return { file, dir: resolve(file, '..'), rules: parsed };
}

// ── validation ──────────────────────────────────────────────────────────────

export interface ValidationIssue {
  where: string;
  message: string;
}

const PREDICATE_KEYS = ['any_file', 'all_files', 'all', 'any', 'not'];
const FILE_KEYS = ['include', 'exclude', 'ext'];
const RULE_KEYS = ['name', 'description', 'when', 'load', 'priority'];
const LOAD_KEYS = ['path', 'file', 'skill', 'type'];
const TOP_KEYS = ['version', 'description', 'rules'];

function checkKeys(object: Record<string, unknown>, allowed: string[], where: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) issues.push({ where, message: `未知字段「${key}」（允许：${allowed.join('/')}）` });
  }
}

function validateFilePredicate(value: unknown, where: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ where, message: '文件谓词必须是对象（可含 include/exclude/ext）' });
    return;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length === 0) issues.push({ where, message: '文件谓词不能为空' });
  for (const key of keys) {
    if (!FILE_KEYS.includes(key)) {
      issues.push({ where, message: `未知字段「${key}」（允许：${FILE_KEYS.join('/')}）` });
      continue;
    }
    const list = object[key];
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
      issues.push({ where, message: `「${key}」必须是字符串数组` });
    }
  }
}

function validatePredicate(value: unknown, where: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ where, message: 'when 必须是对象' });
    return;
  }
  const object = value as Record<string, unknown>;
  checkKeys(object, PREDICATE_KEYS, where, issues);
  const present = PREDICATE_KEYS.filter((key) => key in object);
  if (present.length === 0) {
    issues.push({ where, message: `when 里必须有 ${PREDICATE_KEYS.join('/')} 之一` });
    return;
  }
  if (present.length > 1) {
    issues.push({ where, message: `when 里只能有一个条件键，实际有 ${present.join('、')}` });
  }
  for (const key of present) {
    const inner = object[key];
    if (key === 'not') {
      validatePredicate(inner, `${where}.not`, issues);
      continue;
    }
    if (key === 'all' || key === 'any') {
      if (!Array.isArray(inner) || inner.length === 0) {
        issues.push({ where: `${where}.${key}`, message: '必须是至少一个谓词的数组' });
        continue;
      }
      inner.forEach((item, index) => validatePredicate(item, `${where}.${key}[${index}]`, issues));
      continue;
    }
    // any_file / all_files: either a file predicate or a list of predicates.
    if (Array.isArray(inner)) {
      if (inner.length === 0) issues.push({ where: `${where}.${key}`, message: '不能是空数组' });
      inner.forEach((item, index) => validatePredicate(item, `${where}.${key}[${index}]`, issues));
    } else {
      validateFilePredicate(inner, `${where}.${key}`, issues);
    }
  }
}

/** Structural validation, mirroring `mach lint review-context.toml`'s job. */
export function validateRules(rules: RulesFile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof rules !== 'object' || rules === null) return [{ where: '根', message: '规则文件必须是对象' }];
  checkKeys(rules as unknown as Record<string, unknown>, TOP_KEYS, '根', issues);
  if (rules.version !== 1) issues.push({ where: '版本', message: `version 必须是 1，实际 ${String(rules.version)}` });
  if (!Array.isArray(rules.rules)) {
    issues.push({ where: 'rules', message: 'rules 必须是数组' });
    return issues;
  }
  rules.rules.forEach((rule, index) => {
    const where = `rules[${index}]`;
    if (typeof rule !== 'object' || rule === null) {
      issues.push({ where, message: '规则必须是对象' });
      return;
    }
    checkKeys(rule as unknown as Record<string, unknown>, RULE_KEYS, where, issues);
    if (typeof rule.name !== 'string' || rule.name.trim().length === 0) {
      issues.push({ where, message: 'name 必须是非空字符串' });
    }
    validatePredicate(rule.when, `${where}.when`, issues);
    if (!Array.isArray(rule.load) || rule.load.length === 0) {
      issues.push({ where: `${where}.load`, message: 'load 必须是非空数组' });
    } else {
      rule.load.forEach((entry, loadIndex) => {
        const loadWhere = `${where}.load[${loadIndex}]`;
        if (typeof entry === 'string') {
          if (entry.trim().length === 0) issues.push({ where: loadWhere, message: '裸字符串路径不能为空' });
          return;
        }
        if (typeof entry !== 'object' || entry === null) {
          issues.push({ where: loadWhere, message: 'load 项必须是对象或字符串路径' });
          return;
        }
        checkKeys(entry as unknown as Record<string, unknown>, LOAD_KEYS, loadWhere, issues);
        const target = entry.path ?? entry.file ?? entry.skill;
        if (typeof target !== 'string' || target.trim().length === 0) {
          issues.push({ where: loadWhere, message: '需要 path / file / skill 之一' });
        }
      });
    }
  });
  return issues;
}

// ── evaluation ──────────────────────────────────────────────────────────────

function fileMatches(file: string, predicate: FilePredicate): boolean {
  if (predicate.include !== undefined && !predicate.include.some((glob) => globToRegExp(glob).test(file))) {
    return false;
  }
  if (predicate.exclude !== undefined && predicate.exclude.some((glob) => globToRegExp(glob).test(file))) {
    return false;
  }
  if (predicate.ext !== undefined && !predicate.ext.some((ext) => file.endsWith(ext))) {
    return false;
  }
  return true;
}

function predicateMatches(files: string[], predicate: Predicate | FilePredicate): boolean {
  const keys = Object.keys(predicate);
  const isFilePredicate = keys.length > 0 && keys.every((key) => FILE_KEYS.includes(key));
  if (isFilePredicate) return files.some((file) => fileMatches(file, predicate as FilePredicate));

  const object = predicate as Record<string, unknown>;
  if ('any_file' in object) return asPredicates(object.any_file).some((item) => predicateMatches(files, item));
  if ('all_files' in object) {
    const list = asPredicates(object.all_files);
    return files.length > 0 && files.every((file) => list.some((item) => predicateMatches([file], item)));
  }
  if ('all' in object) return asPredicates(object.all).every((item) => predicateMatches(files, item));
  if ('any' in object) return asPredicates(object.any).some((item) => predicateMatches(files, item));
  if ('not' in object) return !predicateMatches(files, object.not as Predicate);
  return false;
}

function asPredicates(value: unknown): Array<Predicate | FilePredicate> {
  return Array.isArray(value) ? (value as Array<Predicate | FilePredicate>) : [value as FilePredicate];
}

export interface LoadTarget {
  /** `file` = a path in the project, `skill` = an installed skill resolved to its SKILL.md. */
  kind: 'file' | 'skill';
  /** Path as written in the rule. */
  declared: string;
  /** Absolute path when it exists; undefined when the target is missing. */
  resolved?: string;
  /** Project-relative path for display. */
  display?: string;
  skillName?: string;
  /** First line of the skill's `description`, when the target is a skill. */
  summary?: string;
}

function skillSearchRoots(projectRoot: string): string[] {
  const home = process.env.HOME ?? '';
  const roots = [join(projectRoot, '.agents', 'skills'), join(projectRoot, '.claude', 'skills')];
  if (home.length > 0) roots.push(join(home, '.agents', 'skills'), join(home, '.claude', 'skills'));
  return roots;
}

function skillSummary(file: string): string | undefined {
  try {
    const text = readFileSync(file, 'utf8');
    const match = /^---\n([\s\S]*?)\n---/.exec(text);
    const body = match?.[1] ?? '';
    const description = /description:\s*>?-?\s*([\s\S]*?)(?:\n[a-z-]+:|$)/.exec(body)?.[1] ?? '';
    const first = description
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)[0];
    return first;
  } catch {
    return undefined;
  }
}

export function resolveLoad(projectRoot: string, entry: RuleLoad): LoadTarget {
  if (typeof entry.skill === 'string' && entry.skill.length > 0) {
    for (const root of skillSearchRoots(projectRoot)) {
      const candidate = join(root, entry.skill, 'SKILL.md');
      if (existsSync(candidate)) {
        return {
          kind: 'skill',
          declared: entry.skill,
          resolved: candidate,
          display: relative(resolve(projectRoot), candidate),
          skillName: entry.skill,
          summary: skillSummary(candidate),
        };
      }
    }
    return { kind: 'skill', declared: entry.skill, skillName: entry.skill };
  }

  const declared = (entry.path ?? entry.file ?? '').trim();
  const absolute = isAbsolute(declared) ? declared : join(resolve(projectRoot), declared);
  if (existsSync(absolute) && statSync(absolute).isFile()) {
    return { kind: 'file', declared, resolved: absolute, display: relative(resolve(projectRoot), absolute) };
  }
  return { kind: 'file', declared };
}

export interface RuleMatch {
  rule: ContextRule;
  loads: LoadTarget[];
}

export interface EvaluationResult {
  changed: string[];
  matched: RuleMatch[];
  /** Rules whose `load` points at something missing: reported, never fatal (Firefox logs and proceeds). */
  problems: string[];
}

export function evaluateRules(projectRoot: string, rules: RulesFile, changed: string[]): EvaluationResult {
  const problems: string[] = [];
  const matched: RuleMatch[] = [];
  const sorted = [...rules.rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const rule of sorted) {
    if (!predicateMatches(changed, rule.when)) continue;
    const loads: LoadTarget[] = [];
    for (const entry of rule.load) {
      const target = resolveLoad(projectRoot, normalizeLoad(entry));
      if (target.resolved === undefined) {
        problems.push(`规则「${rule.name}」要加载的 ${target.kind === 'skill' ? `技能 ${target.declared}` : `文件 ${target.declared}`} 不存在`);
      }
      loads.push(target);
    }
    matched.push({ rule, loads });
  }
  return { changed, matched, problems };
}

/** Deduplicate load targets across rules — Firefox never injects the same file twice. */
export function dedupeLoads(matches: RuleMatch[]): LoadTarget[] {
  const seen = new Set<string>();
  const out: LoadTarget[] = [];
  for (const match of matches) {
    for (const load of match.loads) {
      const key = load.resolved ?? `${load.kind}:${load.declared}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(load);
    }
  }
  return out;
}

/** Files a project considers "modules": every directory holding its own AGENTS.md. */
export function moduleAgentDocs(projectRoot: string, maxDepth = 4): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === '.git' || entry === 'node_modules' || entry === '.agents') continue;
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      if (existsSync(join(full, 'AGENTS.md'))) {
        found.push(relative(resolve(projectRoot), join(full, 'AGENTS.md')));
        continue; // no need to descend into a module that already documents itself
      }
      walk(full, depth + 1);
    }
  };
  walk(resolve(projectRoot), 1);
  return found.sort();
}

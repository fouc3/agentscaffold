/**
 * Glyph selection for CLI output.
 *
 * Policy, glyph set and the two env escape hatches deliberately mirror the
 * conventions of @colbymchenry/codegraph (MIT, Copyright (c) 2026 Colby Mchenry)
 * so that the rails, spinner and progress bar of this CLI behave the same way on
 * the same terminals. The implementation here is our own.
 *
 * Why a fallback at all: Windows consoles route UTF-8 bytes through the active
 * OEM codepage (CP437, CP936, ...) and render box drawing as mojibake unless the
 * terminal is known to be UTF-8 capable. @clack/prompts decides the same question
 * internally via is-unicode-supported; if the two decisions disagree, one block of
 * output mixes `│` and `|` rails. Keep the Windows branch aligned with clack.
 *
 * Detection:
 *   - `AGENTSCAFFOLD_ASCII=1`   -> ASCII (escape hatch for any terminal)
 *   - `AGENTSCAFFOLD_UNICODE=1` -> Unicode (opt-in on any terminal)
 *   - Windows                   -> same terminals clack recognizes as Unicode
 *   - Linux kernel console (`TERM=linux`) -> ASCII
 *   - Everything else           -> Unicode
 */
export function supportsUnicode(): boolean {
  if (process.env.AGENTSCAFFOLD_ASCII === '1') return false;
  if (process.env.AGENTSCAFFOLD_UNICODE === '1') return true;
  if (process.platform === 'win32') {
    const env = process.env;
    return Boolean(
      env.CI ||
        env.WT_SESSION ||
        env.TERMINUS_SUBLIME ||
        env.ConEmuTask === '{cmd::Cmder}' ||
        env.TERM_PROGRAM === 'Terminus-Sublime' ||
        env.TERM_PROGRAM === 'vscode' ||
        env.TERM === 'xterm-256color' ||
        env.TERM === 'alacritty' ||
        env.TERMINAL_EMULATOR === 'JetBrains-JediTerm',
    );
  }
  return process.env.TERM !== 'linux';
}

export interface Glyphs {
  ok: string;
  err: string;
  info: string;
  warn: string;
  skip: string;
  spinner: string[];
  barFilled: string;
  barEmpty: string;
  rail: string;
  phaseDone: string;
  dash: string;
  hLine: string;
  treeBranch: string;
  treeLast: string;
  treePipe: string;
}

export const UNICODE_GLYPHS: Glyphs = {
  ok: '✓',
  err: '✗',
  info: 'ℹ',
  warn: '⚠',
  skip: '○',
  spinner: ['·', '✢', '✳', '✶', '✻', '✽'],
  barFilled: '█',
  barEmpty: '░',
  rail: '│',
  phaseDone: '◆',
  dash: '—',
  hLine: '─',
  treeBranch: '├── ',
  treeLast: '└── ',
  treePipe: '│   ',
};

export const ASCII_GLYPHS: Glyphs = {
  ok: '[OK]',
  err: '[ERR]',
  info: '[i]',
  warn: '[!]',
  skip: '[-]',
  spinner: ['-', '\\', '|', '/'],
  barFilled: '#',
  barEmpty: '-',
  rail: '|',
  phaseDone: '*',
  dash: '-',
  hLine: '-',
  treeBranch: '|-- ',
  treeLast: '`-- ',
  treePipe: '|   ',
};

let cached: Glyphs | undefined;

export function getGlyphs(): Glyphs {
  cached ??= supportsUnicode() ? UNICODE_GLYPHS : ASCII_GLYPHS;
  return cached;
}

/** Test-only. */
export function _resetGlyphs(): void {
  cached = undefined;
}

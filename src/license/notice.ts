import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { exists, isDirectory, readText, walkFiles } from '../util/fsx.js';
import type { LoadedPack } from '../pack/pack.js';

export const TOOL_LICENSE = 'MIT';
export const MPL_URL = 'https://www.mozilla.org/MPL/2.0/';

export interface UpstreamInfo {
  repo: string;
  path: string;
  commit: string;
  commitUrl: string;
  license: string;
  licenseUrl: string;
  modifications?: string;
}

/**
 * One shipped file, with the licence it actually carries.
 *
 * - `MPL-2.0` + `modified: false` — upstream file kept byte-for-byte.
 * - `MPL-2.0` + `modified: true`  — our rewrite of an upstream file (still MPL, per file-level copyleft).
 * - `MIT`                         — authored here, no upstream counterpart.
 */
export interface PackFile {
  /** Path as installed, prefixed with the pack name. */
  path: string;
  license: 'MPL-2.0' | 'MIT';
  modified: boolean;
  sourceUrl: string;
}

export interface LicenseReport {
  tool: string;
  version: string;
  toolLicense: string;
  /** Only the files actually covered by MPL-2.0. */
  mplFiles: PackFile[];
  /** Everything shipped, including our own MIT files. */
  files: PackFile[];
  sourceUrl: string;
  mplUrl: string;
  thirdPartyUrl: string;
  upstreams: UpstreamInfo[];
  noticesPath?: string;
}

function repositoryUrl(): string | undefined {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8');
    const parsed = JSON.parse(raw) as { repository?: { url?: string } | string };
    const url = typeof parsed.repository === 'string' ? parsed.repository : parsed.repository?.url;
    return url?.replace(/^git\+/, '').replace(/\.git$/, '');
  } catch {
    return undefined;
  }
}

export function collectUpstreams(packs: LoadedPack[]): UpstreamInfo[] {
  const out: UpstreamInfo[] = [];
  for (const pack of packs) {
    const upstream = pack.upstream;
    if (upstream === undefined) continue;
    out.push({
      repo: upstream.repo,
      path: upstream.path,
      commit: upstream.commit,
      commitUrl: `https://github.com/${upstream.repo}/commit/${upstream.commit}`,
      license: upstream.license,
      licenseUrl: MPL_URL,
      modifications: upstream.modifications,
    });
  }
  return out;
}

export function buildLicenseReport(packs: LoadedPack[], version: string): LicenseReport {
  const files: PackFile[] = [];

  for (const pack of packs) {
    const upstream = pack.upstream;
    const upstreamRoot = join(pack.root, 'upstream');
    const hasUpstream = upstream !== undefined && isDirectory(upstreamRoot);
    // The manifest's file list — not "everything under upstream/" — decides what is
    // third-party. Provenance metadata we generated lives there too and stays ours.
    const declared = new Set(upstream?.files ?? []);
    const sourceOf = (file: string): string =>
      upstream === undefined
        ? 'agentscaffold (original)'
        : `https://github.com/${upstream.repo}/blob/${upstream.commit}/${upstream.path}/${file}`;

    // 1. Verbatim upstream copies (MPL-2.0, unmodified).
    if (hasUpstream) {
      for (const file of walkFiles(upstreamRoot)) {
        if (file.startsWith('.')) continue; // machine-local metadata, not shipped content
        const thirdParty = declared.has(file);
        files.push({
          path: `${pack.name}:upstream/${file}`,
          license: thirdParty ? 'MPL-2.0' : 'MIT',
          modified: false,
          sourceUrl: thirdParty ? sourceOf(file) : 'agentscaffold (original)',
        });
      }
    }

    // 2. Skill files: an upstream counterpart makes it an MPL derivative; otherwise MIT.
    for (const skill of pack.skills) {
      const root = join(pack.root, skill.dir);
      if (!isDirectory(root)) continue;
      for (const file of walkFiles(root)) {
        if (file.startsWith('.')) continue;
        const derived = declared.has(file);
        files.push({
          path: `${pack.name}:${file}`,
          license: derived ? 'MPL-2.0' : 'MIT',
          modified: derived,
          sourceUrl: derived ? sourceOf(file) : 'agentscaffold (original)',
        });
      }
    }
  }

  const notices = packs.map((pack) => join(pack.root, 'THIRD-PARTY-NOTICES.md')).find((file) => exists(file));
  const repo = repositoryUrl();
  const mplFiles = files.filter((file) => file.license === 'MPL-2.0');

  return {
    tool: 'agentscaffold',
    version,
    toolLicense: TOOL_LICENSE,
    mplFiles,
    files,
    sourceUrl: collectUpstreams(packs)[0]?.commitUrl ?? repo ?? '',
    mplUrl: MPL_URL,
    thirdPartyUrl:
      repo === undefined
        ? 'packs/perf-regression-triage/THIRD-PARTY-NOTICES.md'
        : `${repo}/blob/main/packs/perf-regression-triage/THIRD-PARTY-NOTICES.md`,
    upstreams: collectUpstreams(packs),
    ...(notices === undefined ? {} : { noticesPath: notices }),
  };
}

/** `--help` footer: exactly this, nothing longer. */
export function helpLicenseBlock(report: LicenseReport): string {
  return [
    'License:',
    `  本工具自身: ${report.toolLicense}`,
    '  随包技能文件: 部分为 MPL-2.0',
    '  MPL-2.0 是文件级 copyleft；不会要求你开源你的项目，也不会改变你项目的许可证。',
    '  项目级安装会把这些 MPL 文件放入 <project>/.agents/skills/；',
    '  若再分发，请保留随附许可证与声明。',
    `  运行 \`${report.tool} --license\` 查看完整信息。`,
  ].join('\n');
}

function describe(file: PackFile): string {
  if (file.license === 'MIT') return `${file.path}  (本项目原创, MIT)`;
  return file.modified ? `${file.path}  (改写, MPL-2.0 衍生)` : `${file.path}  (原样保留, MPL-2.0)`;
}

export function formatLicenseHuman(report: LicenseReport): string {
  const mplLines = report.mplFiles.map((file) => `  ${describe(file)}`);
  const ownLines = report.files.filter((file) => file.license === 'MIT').map((file) => `  ${describe(file)}`);
  const lines: string[] = [
    `${report.tool} ${report.version}`,
    '',
    `本工具自身许可证: ${report.toolLicense}`,
    '随包 MPL-2.0 文件:',
    ...(mplLines.length === 0 ? ['  （无）'] : mplLines),
    '',
    'MPL-2.0 要点:',
    '- 义务仅适用于被 MPL 覆盖的文件。',
    '- 不要求开源你的项目其他部分，也不改变你项目的许可证。',
    '- 未修改再分发：保留版权/许可证声明，并提供源码获取方式。',
    '- 修改后再分发：需公开修改后的这些 MPL 文件。',
    '- 不要把 MPL 文件内容合并进你自己的源文件；合并后的文件可能受 MPL 约束。',
    '- 不得用 Mozilla/Firefox 名称或 logo 暗示官方背书。',
    '',
    '源码与声明:',
    `- 原始项目/来源: ${report.sourceUrl}`,
    `- MPL-2.0 全文: ${report.mplUrl}`,
    `- 第三方声明: ${report.thirdPartyUrl}`,
  ];
  if (ownLines.length > 0) {
    lines.push('', '本项目自行撰写（不受 MPL 影响）:', ...ownLines);
  }
  if (report.upstreams.length > 0) {
    lines.push('', '上游明细:');
    for (const upstream of report.upstreams) {
      lines.push(`- ${upstream.repo} :: ${upstream.path}`);
      lines.push(`  固定提交: ${upstream.commit}`);
      if (upstream.modifications !== undefined) lines.push(`  改动: ${upstream.modifications}`);
    }
  }
  lines.push('', '本说明不是法律意见。');
  return `${lines.join('\n')}\n`;
}

/** Exact schema the compliance scanners / agents expect. */
export function formatLicenseJson(report: LicenseReport): string {
  return `${JSON.stringify(
    {
      tool: report.tool,
      version: report.version,
      tool_license: report.toolLicense,
      mpl_files: report.mplFiles.map((file) => file.path),
      project_license_impact: 'none',
      notice:
        'MPL-2.0 applies only to listed files. It does not require opening or relicensing your project.',
      source_url: report.sourceUrl,
      mpl_url: report.mplUrl,
      third_party_notices: report.thirdPartyUrl,
    },
    null,
    2,
  )}\n`;
}

export function trademarkNotice(packs: LoadedPack[]): string {
  return packs
    .map((pack) => join(pack.root, 'TRADEMARKS.md'))
    .filter((file) => exists(file))
    .map((file) => readText(file).trim())
    .join('\n\n');
}

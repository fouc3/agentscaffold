// Post-build step: make the CLI entry executable and sanity-check the shipped packs.
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(root, 'dist', 'bin', 'agentscaffold.js');

if (!existsSync(bin)) {
  console.error(`postbuild: 缺少构建产物 ${bin}`);
  process.exit(1);
}
chmodSync(bin, 0o755);

const packsDir = join(root, 'packs');
const packs = existsSync(packsDir) ? readFileSync(join(packsDir, 'perf-regression-triage', 'pack.json'), 'utf8') : '';
const manifest = JSON.parse(packs);
console.log(`postbuild: ${manifest.name} v${manifest.version} [${manifest.license}] — CLI 可执行`);

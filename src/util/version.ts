import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const toolVersion: string = (() => {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
})();

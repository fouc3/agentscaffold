/**
 * The private tools prefix: one place that answers "where do our installs live".
 *
 * Kept separate from `tool-install.ts` because the probe layer (`cli-deps.ts`) also needs it, and
 * a value import in both directions would be a cycle.
 */
import { join } from 'node:path';

/** Our private prefix. Overridable so tests never touch the real one. */
export function toolsDir(): string {
  const override = process.env.AGENTSCAFFOLD_TOOLS_DIR;
  if (override !== undefined && override.length > 0) return override;
  return join(process.env.HOME ?? process.cwd(), '.agents', 'tools');
}

/** Where both managers put executables: cargo `--root` and npm `-g --prefix` both use `<dir>/bin`. */
export function toolsBinDir(): string {
  return join(toolsDir(), 'bin');
}

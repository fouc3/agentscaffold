/**
 * Minimal ANSI styling. Colour is dropped when stdout is not a TTY, when NO_COLOR
 * is set, or on a dumb terminal, so redirected output stays parseable.
 */
const plain = !process.stdout.isTTY || process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb';

function style(open: number): (text: string) => string {
  if (plain) return (text: string) => text;
  const prefix = `\u001b[${open}m`;
  const suffix = '\u001b[0m';
  return (text: string) => `${prefix}${text}${suffix}`;
}

export const bold = style(1);
export const dim = style(2);
export const italic = style(3);
export const red = style(31);
export const green = style(32);
export const yellow = style(33);
export const blue = style(34);
export const magenta = style(35);
export const cyan = style(36);
export const gray = style(90);

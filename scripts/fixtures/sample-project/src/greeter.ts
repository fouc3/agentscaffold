export interface Greeter {
  greet(name: string): string;
}

export class FriendlyGreeter implements Greeter {
  greet(name: string): string {
    return `hi ${name}`;
  }
}

export function makeGreeter(): Greeter {
  return new FriendlyGreeter();
}

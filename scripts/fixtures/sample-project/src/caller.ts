import { makeGreeter, type Greeter } from './greeter';

export function greetTwice(name: string): string {
  const greeter: Greeter = makeGreeter();
  return `${greeter.greet(name)} / ${greeter.greet(name)}`;
}

import { redactSecrets } from '../connectionTest.js';

export { codexOutputSecrets } from './extension-injection.js';

/** Scrub displayed content; native correlation identifiers remain byte-exact. */
export function redactCodexOutput(value: unknown, secrets: string[], displayText = false): unknown {
  if (typeof value === 'string') return displayText ? redactSecrets(value, secrets) : value;
  if (Array.isArray(value)) return value.map((entry) => redactCodexOutput(entry, secrets, displayText));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    redactCodexOutput(entry, secrets, /^(?:message|detail|details|description|reason|command|output|stdout|stderr|delta|text|raw|error|summary|result)$/u.test(key)),
  ]));
  return value;
}

/** Retain partial credential prefixes across arbitrary stderr/stdout chunks. */
export function createCodexTextRedactor(secrets: string[]) {
  let pending = '';
  return {
    write(chunk: string): string {
      pending = redactSecrets(pending + chunk, secrets);
      let retain = 0;
      for (const secret of secrets) {
        for (let length = Math.min(secret.length - 1, pending.length); length > retain; length -= 1) {
          if (pending.endsWith(secret.slice(0, length))) { retain = length; break; }
        }
      }
      const output = pending.slice(0, pending.length - retain);
      pending = retain ? pending.slice(-retain) : '';
      return redactSecrets(output, secrets);
    },
    flush(): string { const output = redactSecrets(pending, secrets); pending = ''; return output; },
  };
}

import type { ZodError } from 'zod';

/** Flattens a Zod error into { fieldName: firstMessage }, for TextField's errorMessage prop. */
export function fieldErrorsFromZod(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_root');
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

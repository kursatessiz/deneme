import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { BASE_MESSAGES, parseValidationMessage, validationBaseMessage, vmsg } from '@platform/shared';

/** The shared package sources (guarded here because that package has no Node types). */
const SHARED_SRC = join(__dirname, '../../../../packages/shared/src');

/** Zod calls whose message argument shows up in a form or in `errors[]` of a 400 response. */
const RULE_METHODS = new Set(['min', 'max', 'length', 'regex', 'email', 'url', 'startsWith', 'endsWith', 'refine', 'superRefine', 'int', 'positive', 'nonnegative', 'nonempty', 'uuid', 'datetime']);
const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;
const SKIP = /(permissions\.ts|open-platform\.ts|platform-permissions\.ts|\.spec\.ts)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'messages' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.ts') && !SKIP.test(full)) out.push(full);
  }
  return out;
}

/** Turkish literals used as a Zod message: `message: '...'` or the message argument of a rule method. */
function literalMessages(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && TURKISH.test(node.getText())) {
      const parent = node.parent;
      const asMessageProp = ts.isPropertyAssignment(parent) && parent.initializer === node && parent.name.getText() === 'message';
      const asRuleArg = ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && RULE_METHODS.has(parent.expression.name.text) && parent.arguments.includes(node as ts.Expression);
      if (asMessageProp || asRuleArg) found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText().slice(0, 60)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Shared Zod schemas must not carry Turkish sentences: see docs/I18N.md, "Doğrulama mesajları". */
describe('shared validation messages', () => {
  it('keeps Turkish sentences out of Zod rules: a rule message is a validation.* key (vmsg)', () => {
    const offenders = sourceFiles(SHARED_SRC).flatMap(literalMessages);
    expect(offenders).toEqual([]);
  });

  it('round-trips a key with parameters and leaves other text alone', () => {
    const message = vmsg('validation.stepsMin', { min: 2 });
    expect(parseValidationMessage(message)).toEqual({ key: 'validation.stepsMin', params: { min: 2 } });
    expect(validationBaseMessage(message)).toBe('En az 2 adım gerekir');
    expect(validationBaseMessage('Invalid input')).toBe('Invalid input');
    expect(parseValidationMessage('validation.doesNotExist')).toBeNull();
  });

  it('defines every vmsg key used by the schemas in the Turkish catalogue', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(SHARED_SRC)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/vmsg\('(validation\.[A-Za-z0-9]+)'/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(100);
    for (const key of used) expect(Object.prototype.hasOwnProperty.call(BASE_MESSAGES, key)).toBe(true);
  });
});

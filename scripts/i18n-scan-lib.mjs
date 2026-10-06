// Scanner behind the i18n regression guard (docs/I18N.md, "Regresyon korumasi").
// Pure functions over source text; the CLI lives in check-i18n.mjs.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/** Characters that only occur in Turkish text; a string literal or JSX text holding one is user-visible copy that belongs in messages/. */
export const TURKISH_CHARS = /[çğıöşüÇĞİÖŞÜ]/;

const NATIVE_DIALOGS = new Set(['confirm', 'alert', 'prompt']);

/** Names declared anywhere in the file (functions, variables incl. destructuring, parameters), so a local `confirm` from useConfirm() is not a native dialog. */
function declaredNames(sf) {
  const names = new Set();
  const addBinding = (b) => {
    if (ts.isIdentifier(b)) names.add(b.text);
    else if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) {
      for (const el of b.elements) if (ts.isBindingElement(el)) addBinding(el.name);
    }
  };
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) addBinding(node.name);
    ts.forEachChild(node, visit);
  })(sf);
  return names;
}

/**
 * Returns findings `{ line, kind, text }` for one file.
 *  - `turkish`: a Turkish-character string literal, template chunk or JSX text.
 *  - `native-dialog` (web only): window.confirm/alert/prompt or an undeclared bare confirm/alert/prompt call.
 *  - `alert-no-buttons` (mobile only): Alert.alert without a buttons array, which shows the OS-default "OK".
 */
export function scanSource(fileName, text, { platform }) {
  const scriptKind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];
  const add = (node, kind, value) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    findings.push({ line, kind, text: value.replace(/\s+/g, ' ').trim().slice(0, 90) });
  };
  const declared = platform === 'web' ? declaredNames(sf) : new Set();

  (function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (TURKISH_CHARS.test(node.text)) add(node, 'turkish', node.text);
    } else if (ts.isJsxText(node)) {
      if (TURKISH_CHARS.test(node.text)) add(node, 'turkish', node.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (platform === 'web') {
        const viaWindow =
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          (callee.expression.text === 'window' || callee.expression.text === 'globalThis') &&
          NATIVE_DIALOGS.has(callee.name.text);
        const bare = ts.isIdentifier(callee) && NATIVE_DIALOGS.has(callee.text) && !declared.has(callee.text);
        if (viaWindow || bare) add(node, 'native-dialog', callee.getText(sf));
      } else if (ts.isPropertyAccessExpression(callee) && callee.expression.getText(sf) === 'Alert' && callee.name.text === 'alert' && node.arguments.length < 3) {
        add(node, 'alert-no-buttons', node.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
  return findings;
}

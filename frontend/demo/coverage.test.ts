import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { matchRoute } from './router.ts';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(f => /\.tsx?$/.test(f) && !/\.(test|d)\.ts$/.test(f)).map(f => src + f);
const program = ts.createProgram(files, { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, noResolve: true, noLib: true });
const checker = program.getTypeChecker();
const combine = (left: string[], right: string[]) => left.flatMap(a => right.map(b => a + b));
function values(node: ts.Node | undefined, seen = new Set<ts.Node>()): string[] {
  if (!node || seen.has(node)) return [':value'];
  seen = new Set(seen).add(node);
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return values(node.expression, seen);
  if (ts.isConditionalExpression(node)) return [...values(node.whenTrue, seen), ...values(node.whenFalse, seen)];
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return combine(values(node.left, seen), values(node.right, seen));
  if (ts.isTemplateExpression(node)) return node.templateSpans.reduce((out, span) => combine(out, values(span.expression, seen)).map(s => s + span.literal.text), [node.head.text]);
  if (ts.isIdentifier(node)) {
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration)) return values(declaration.initializer, seen);
    if (declaration && ts.isParameter(declaration) && declaration.initializer) return values(declaration.initializer, seen);
    // Shared people-list hook receives its path from callers and PeoplePicker's public prop.
    if (node.text === 'path' && node.getSourceFile().fileName.endsWith('/PeopleDirectory.tsx')) return peoplePaths();
  }
  const type = checker.getTypeAtLocation(node);
  if (type.isUnion() && type.types.every(t => t.isStringLiteral())) return type.types.map(t => (t as ts.StringLiteralType).value);
  if (type.isStringLiteral()) return [type.value];
  return [':value'];
}
function peoplePaths() {
  const paths = new Set(['exams/audience-options/']);
  for (const file of files) {
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText() === 'usePeoplePage' && !file.endsWith('/PeopleDirectory.tsx')) values(node.arguments[0]).forEach(p => paths.add(p));
      if (ts.isJsxAttribute(node) && node.name.getText() === 'path' && node.initializer) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        values(value).filter(p => p.includes('/')).forEach(p => paths.add(p));
      }
      ts.forEachChild(node, walk);
    };
    walk(program.getSourceFile(file)!);
  }
  return [...paths];
}
export function extractedPaths() {
  const calls: { file: string; line: number; paths: string[] }[] = [];
  for (const file of files) {
    if (file.endsWith('/api.ts')) continue; // The transport wrapper, not an endpoint call site.
    const source = program.getSourceFile(file)!;
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ['api', 'downloadFile', 'appPath'].includes(node.expression.getText(source))) {
        const name = node.expression.getText(source);
        const paths = values(node.arguments[0]).filter(p => name !== 'appPath' || p.startsWith('/api/')).map(p => p.replace(/^\/api\//, '').split('?')[0]);
        if (paths.length) calls.push({ file: file.slice(src.length), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, paths });
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  return calls;
}
test('every frontend API/download path has a handler or explicit refusal in the dispatch table', () => {
  const calls = extractedPaths();
  assert.ok(calls.length > 140, 'Extraction must cover the complete frontend');
  const missing = calls.flatMap(call => call.paths.filter(path => !matchRoute(path)).map(path => `${call.file}:${call.line} ${path}`));
  assert.deepEqual(missing, []);
  assert.equal(matchRoute('courses/1/new-unimplemented-feature/'), undefined, 'No prefix catchalls that hide new endpoints');
});
test('every demo t() literal has three translations, with no shared/demo overlap', () => {
  const shared = JSON.parse(readFileSync(new URL('../../shared/locales/messages.json', import.meta.url), 'utf8'));
  const demo = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(demo).filter(key => Object.hasOwn(shared, key)), []);
  const messages = { ...shared, ...demo };
  for (const key of Object.keys(demo)) check(key);
  const directory = fileURLToPath(new URL('./', import.meta.url));
  for (const file of readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter(f => /\.tsx?$/.test(f))) {
    const source = ts.createSourceFile(file, readFileSync(directory + file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const literalKeys = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node)) check(node.text);
      else if (ts.isConditionalExpression(node)) { literalKeys(node.whenTrue); literalKeys(node.whenFalse); }
      else if (ts.isParenthesizedExpression(node)) literalKeys(node.expression);
    };
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0]) literalKeys(node.arguments[0]);
      ts.forEachChild(node, walk);
    };
    walk(source);
    if (['main.tsx', 'scorm.ts'].includes(file)) {
      const first = source.statements[0];
      assert.ok(ts.isImportDeclaration(first) && ts.isStringLiteral(first.moduleSpecifier) && first.moduleSpecifier.text === './catalogue', `${file} must install demo translations first`);
    }
  }
  function check(key: string) { for (const lang of ['en', 'zh-TW', 'es']) assert.ok(messages[key]?.[lang], `${lang}: ${key}`); }
});

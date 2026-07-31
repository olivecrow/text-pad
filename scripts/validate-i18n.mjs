import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const localeFiles = [
  'en.ts',
  'ko.ts',
  'ja.ts',
  'zh-CN.ts',
  'es.ts',
  'fr.ts',
  'de.ts',
  'pt-BR.ts',
  'ru.ts',
  'ar.ts'
];
const localeDirectory = path.join(process.cwd(), 'src', 'lib', 'i18n');

function readTranslationTable(fileName) {
  const filePath = path.join(localeDirectory, fileName);
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const entries = new Map();
  const duplicateKeys = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      const initializer = ts.isAsExpression(declaration.initializer)
        ? declaration.initializer.expression
        : declaration.initializer;
      if (!ts.isObjectLiteralExpression(initializer)) continue;
      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.name) || !ts.isStringLiteralLike(property.initializer)) continue;
        const key = property.name.text;
        if (entries.has(key)) duplicateKeys.push(key);
        entries.set(key, property.initializer.text);
      }
    }
  }

  if (entries.size === 0) throw new Error(`${fileName}: translation table was not found`);
  if (duplicateKeys.length > 0) throw new Error(`${fileName}: duplicate keys: ${duplicateKeys.join(', ')}`);
  return entries;
}

function placeholders(value) {
  return [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
}

const sourceTable = readTranslationTable('en.ts');
const sourceKeys = [...sourceTable.keys()];
const issues = [];

for (const fileName of localeFiles.slice(1)) {
  const table = readTranslationTable(fileName);
  const missing = sourceKeys.filter((key) => !table.has(key));
  const extra = [...table.keys()].filter((key) => !sourceTable.has(key));
  if (missing.length > 0) issues.push(`${fileName}: missing keys: ${missing.join(', ')}`);
  if (extra.length > 0) issues.push(`${fileName}: extra keys: ${extra.join(', ')}`);

  for (const key of sourceKeys) {
    if (!table.has(key)) continue;
    const expected = placeholders(sourceTable.get(key));
    const actual = placeholders(table.get(key));
    if (expected.join('\0') !== actual.join('\0')) {
      issues.push(`${fileName}: placeholder mismatch for ${key}; expected [${expected.join(', ')}], got [${actual.join(', ')}]`);
    }
  }
}

if (issues.length > 0) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${localeFiles.length} locale tables with ${sourceKeys.length} keys each.`);
}

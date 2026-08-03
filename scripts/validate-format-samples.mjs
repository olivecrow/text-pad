import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supported-text-formats.json'), 'utf8'));
const expectedTokenTypes = {
  markdown: ['heading-marker', 'strong', 'emphasis', 'link', 'quote-marker', 'list-marker', 'code'],
  json: ['key', 'string', 'number', 'boolean'],
  jsonc: ['key', 'string', 'boolean', 'comment'],
  jsonlines: ['key', 'string', 'number', 'boolean'],
  xml: ['tag', 'attribute', 'string', 'keyword', 'comment', 'directive'],
  gettext: ['directive', 'string', 'keyword'],
  yaml: ['key', 'number', 'list-marker', 'literal'],
  toml: ['section', 'key', 'operator', 'string', 'number', 'boolean', 'comment'],
  ini: ['section', 'key', 'operator', 'string', 'number', 'boolean', 'comment'],
  conf: ['key', 'operator', 'string', 'number', 'boolean', 'comment'],
  properties: ['key', 'operator', 'number', 'boolean', 'comment'],
  dotenv: ['key', 'operator', 'string', 'number', 'boolean', 'comment'],
  gitignore: ['pattern', 'keyword', 'operator', 'comment'],
  gitattributes: ['pattern', 'attribute', 'operator'],
  gitconfig: ['section', 'key', 'operator', 'string'],
  editorconfig: ['section', 'key', 'operator', 'string', 'boolean'],
  npmrc: ['key', 'operator', 'string', 'boolean'],
  dockerignore: ['pattern', 'keyword', 'operator', 'comment'],
  ignore: ['pattern', 'keyword', 'operator', 'comment'],
  codeowners: ['pattern', 'owner', 'comment'],
  gitmessage: ['directive', 'operator', 'string', 'comment'],
  gitmailmap: ['owner', 'comment'],
  gitblame: ['hash', 'comment'],
  registry: ['directive', 'section', 'key', 'operator', 'string', 'number', 'comment'],
  sshconfig: ['directive', 'pattern', 'string', 'comment'],
  systemd: ['section', 'directive', 'operator', 'string', 'keyword'],
  hosts: ['keyword', 'host', 'comment'],
  log: ['timestamp', 'keyword'],
  srt: ['number', 'timestamp', 'operator'],
  webvtt: ['keyword', 'timestamp', 'operator', 'comment'],
  lrc: ['timestamp', 'key', 'operator', 'string']
};

function getLineStarts(content) {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function flattenTokens(tokens) {
  return tokens.map((token) => token.children ? flattenTokens(token.children) : token.text || '').join('');
}

function collectTokenTypes(tokens, output) {
  for (const token of tokens) {
    output.add(token.type);
    if (token.children) collectTokenTypes(token.children, output);
  }
}

const markdownSettings = {
  hideHeadingMarkers: true,
  showHeadingDividers: true,
  headings: {
    1: { sizePercent: 145, fontWeight: '700' },
    2: { sizePercent: 135, fontWeight: '700' },
    3: { sizePercent: 125, fontWeight: '600' },
    4: { sizePercent: 115, fontWeight: '600' },
    5: { sizePercent: 108, fontWeight: '600' },
    6: { sizePercent: 100, fontWeight: '600' }
  }
};

const server = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true }
});

try {
  const module = await server.ssrLoadModule('/src/lib/document-formats.ts');
  const summaries = [];
  const categorizedIds = module.configurableDocumentFormatCategories.flatMap((category) => category.formatIds);
  if (new Set(categorizedIds).size !== categorizedIds.length) {
    throw new Error('A configurable document format appears in more than one settings category.');
  }
  const configurableIds = module.configurableDocumentFormats.map((format) => format.id).sort();
  if (JSON.stringify([...categorizedIds].sort()) !== JSON.stringify(configurableIds)) {
    throw new Error('Settings categories must contain every configurable document format exactly once.');
  }

  for (const entry of manifest.formats) {
    const samplePath = path.join(root, ...entry.sample.split('/'));
    const content = fs.readFileSync(samplePath, 'utf8');
    const lineStartOffsets = getLineStarts(content);
    const renderCache = module.createDocumentRenderCache();
    const originalContent = content;
    const result = module.parseDocumentForRender(content, {
      pathOrName: entry.sample,
      tabSize: 4,
      lineStartOffsets,
      lineRange: { startLine: 0, endLine: lineStartOffsets.length - 1 },
      markdownSettings,
      renderCache
    });

    if (result.format.id !== entry.id) {
      throw new Error(`${entry.sample}: detected ${result.format.id}, expected ${entry.id}.`);
    }
    if (module.getDocumentDiagnostic(content, { pathOrName: entry.sample, locale: 'ko' })) {
      throw new Error(`${entry.sample}: the valid sample produced a diagnostic.`);
    }
    if (content !== originalContent) {
      throw new Error(`${entry.sample}: rendering changed the source text.`);
    }

    const sourceLines = content.split('\n').map((line) => line.endsWith('\r') ? line.slice(0, -1) : line);
    if (result.lines.length !== sourceLines.length) {
      throw new Error(`${entry.sample}: rendered ${result.lines.length} lines for ${sourceLines.length} source lines.`);
    }
    for (let index = 0; index < sourceLines.length; index += 1) {
      const reconstructed = flattenTokens(result.lines[index]?.tokens || []);
      if (reconstructed !== sourceLines[index]) {
        throw new Error(`${entry.sample}:${index + 1}: token text does not reconstruct the source line.`);
      }
    }

    if (lineStartOffsets.length > 1) {
      const rangeStart = Math.max(1, Math.floor(lineStartOffsets.length / 2));
      const rangeEnd = Math.min(lineStartOffsets.length - 1, rangeStart + 2);
      const rangeResult = module.parseDocumentForRender(content, {
        pathOrName: entry.sample,
        tabSize: 4,
        lineStartOffsets,
        lineRange: { startLine: rangeStart, endLine: rangeEnd },
        markdownSettings,
        renderCache
      });
      const expectedLines = result.lines.slice(rangeStart, rangeEnd + 1);
      if (JSON.stringify(rangeResult.lines) !== JSON.stringify(expectedLines)) {
        throw new Error(`${entry.sample}: visible range ${rangeStart + 1}-${rangeEnd + 1} differs from the full render.`);
      }
    }

    const tokenTypes = new Set();
    for (const line of result.lines) collectTokenTypes(line.tokens, tokenTypes);
    if (tokenTypes.has('invalid')) {
      throw new Error(`${entry.sample}: a valid sample produced an invalid render token.`);
    }
    for (const expectedType of expectedTokenTypes[entry.id] || []) {
      if (!tokenTypes.has(expectedType)) {
        throw new Error(`${entry.sample}: missing expected ${expectedType} token; found ${Array.from(tokenTypes).sort().join(", ")}.`);
      }
    }

    if (entry.id === 'markdown') {
      const headingLines = result.lines.filter((line) => line.headingLevel !== undefined);
      const hiddenMarkers = headingLines.flatMap((line) => line.tokens)
        .filter((token) => token.type === 'heading-marker' && token.hiddenSyntax);
      if (headingLines.length < 3 || hiddenMarkers.length !== headingLines.length) {
        throw new Error(`${entry.sample}: Markdown headings or hidden markers are incomplete.`);
      }
      const shown = module.parseDocumentForRender(content, {
        pathOrName: entry.sample,
        tabSize: 4,
        lineStartOffsets,
        lineRange: { startLine: 0, endLine: lineStartOffsets.length - 1 },
        markdownSettings: { ...markdownSettings, hideHeadingMarkers: false }
      });
      if (shown.lines.flatMap((line) => line.tokens).some((token) => token.type === 'heading-marker' && token.hiddenSyntax)) {
        throw new Error(`${entry.sample}: visible heading-marker setting was ignored.`);
      }
    }

    summaries.push(`${entry.id}:${path.extname(entry.sample)}:${result.lines.length}`);
  }

  const invalidCases = [
    { name: 'invalid.csv', content: 'name,note\ntext-pad,"unclosed', line: 2 },
    { name: 'invalid.tsv', content: 'name\tnote\ntext-pad\tbad"quote', line: 2 },
    { name: 'invalid.jsonl', content: '{"ok":true}\n{"broken":}', line: 2 },
    { name: 'invalid.jsonc', content: '{\n  // comment\n  "broken":,\n}', line: 3 },
    { name: 'invalid.xml', content: '<root>\n  <child></root>', line: 2 },
    { name: 'invalid.po', content: 'msgstr "orphan"', line: 1 },
    { name: 'invalid.toml', content: 'enabled = tru', line: 1 },
    { name: 'invalid.ini', content: '[editor\ntheme=dark', line: 1 },
    { name: 'invalid.properties', content: 'heart=\\u12Q4', line: 1 },
    { name: 'invalid.env', content: 'TITLE="open', line: 1 },
    { name: 'invalid.gitattributes', content: '*.txt !', line: 1 },
    { name: 'invalid.gitconfig', content: '[core', line: 1 },
    { name: 'invalid.editorconfig', content: 'indent style = space', line: 1 },
    { name: 'invalid.npmrc', content: '[section]', line: 1 },
    { name: 'invalid.gitignore', content: '!', line: 1 },
    { name: 'invalid.dockerignore', content: '!', line: 1 },
    { name: 'invalid.ignore', content: '!', line: 1 },
    { name: 'CODEOWNERS', content: '/docs/ docs-team', line: 1 },
    { name: 'invalid.mailmap', content: 'No email mapping', line: 1 },
    { name: '.git-blame-ignore-revs', content: '0123', line: 1 },
    { name: 'invalid.reg', content: 'Windows Registry Editor Version 5.00\n[HKEY_CURRENT_USER\\Software\\text-pad]\n"Size"=dword:12', line: 3 },
    { name: 'ssh_config', content: 'Host', line: 1 },
    { name: 'invalid.service', content: '[Unit', line: 1 },
    { name: 'hosts', content: '999.0.0.1 invalid.local', line: 1 },
    { name: 'invalid.srt', content: '1\n00:00:03,000 --> 00:00:02,000\ntext', line: 2 },
    { name: 'invalid.vtt', content: 'WEBVTT\n\n00:61.000 --> 00:02.000\ntext', line: 3 },
    { name: 'orphan.vtt', content: 'WEBVTT\n\norphan cue', line: 3 },
    { name: 'invalid.lrc', content: '[00:x1.00]text', line: 1 }
  ];
  for (const invalid of invalidCases) {
    const diagnostic = module.getDocumentDiagnostic(invalid.content, {
      pathOrName: invalid.name,
      locale: 'ko'
    });
    if (!diagnostic || diagnostic.line !== invalid.line) {
      throw new Error(`${invalid.name}: expected a diagnostic on line ${invalid.line}.`);
    }
  }

  const pathDetectionCases = [
    ['C:/project/.vscode/settings.json', 'jsonc'],
    ['C:/project/tsconfig.json', 'jsonc'],
    ['C:/project/.env.local', 'dotenv'],
    ['C:/project/.git/config', 'gitconfig'],
    ['C:/project/.git/info/sparse-checkout', 'gitignore'],
    ['C:/Users/example/.config/git/ignore', 'gitignore'],
    ['C:/project/.prettierignore', 'ignore'],
    ['C:/project/.github/CODEOWNERS', 'codeowners'],
    ['C:/project/.git/COMMIT_EDITMSG', 'gitmessage'],
    ['C:/project/.mailmap', 'gitmailmap'],
    ['C:/project/.git-blame-ignore-revs', 'gitblame'],
    ['C:/Users/example/.ssh/config', 'sshconfig'],
    ['C:/Windows/System32/drivers/etc/hosts', 'hosts'],
    ['C:/etc/systemd/system/text-pad.service', 'systemd'],
    ['C:/project/catalog.xml', 'xml'],
    ['C:/project/data.json', 'json']
  ];
  for (const [filePath, expectedFormat] of pathDetectionCases) {
    const actualFormat = module.getDocumentFormatForPath(filePath).id;
    if (actualFormat !== expectedFormat) {
      throw new Error(`${filePath}: detected ${actualFormat}, expected ${expectedFormat}.`);
    }
  }

  console.log(`Rendered and validated ${summaries.length} format samples: ${summaries.join(', ')}`);
  console.log(`Detected ${invalidCases.length} representative syntax errors at the expected lines.`);
  console.log(`Detected ${pathDetectionCases.length} representative file-name and path routing cases.`);
} finally {
  await server.close();
}

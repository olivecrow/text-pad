import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supported-text-formats.json'), 'utf8'));
const expectedTokenTypes = {
  markdown: ['heading-marker', 'strong', 'emphasis', 'link', 'quote-marker', 'list-marker', 'code'],
  json: ['key', 'string', 'number', 'boolean'],
  jsonlines: ['key', 'string', 'number', 'boolean'],
  yaml: ['key', 'number', 'list-marker', 'literal'],
  ini: ['section', 'key', 'operator', 'string', 'number', 'boolean', 'comment'],
  conf: ['key', 'operator', 'string', 'number', 'boolean', 'comment'],
  properties: ['key', 'operator', 'number', 'boolean', 'comment'],
  dotenv: ['key', 'operator', 'string', 'number', 'boolean', 'comment'],
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

  for (const entry of manifest.formats) {
    const samplePath = path.join(root, ...entry.sample.split('/'));
    const content = fs.readFileSync(samplePath, 'utf8');
    const lineStartOffsets = getLineStarts(content);
    const originalContent = content;
    const result = module.parseDocumentForRender(content, {
      pathOrName: entry.sample,
      tabSize: 4,
      lineStartOffsets,
      lineRange: { startLine: 0, endLine: lineStartOffsets.length - 1 },
      markdownSettings
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

    const tokenTypes = new Set();
    for (const line of result.lines) collectTokenTypes(line.tokens, tokenTypes);
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
    { name: 'invalid.ini', content: '[editor\ntheme=dark', line: 1 },
    { name: 'invalid.properties', content: 'heart=\\u12Q4', line: 1 },
    { name: 'invalid.env', content: 'TITLE="open', line: 1 },
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

  console.log(`Rendered and validated ${summaries.length} format samples: ${summaries.join(', ')}`);
  console.log(`Detected ${invalidCases.length} representative syntax errors at the expected lines.`);
} finally {
  await server.close();
}

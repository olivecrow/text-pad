import { CST, Lexer } from 'yaml';
import type { Token } from './render-tokenizer';
import type { ParsedLine, PrettyPrintRow } from './structured-rendering';
import { MAX_PRETTY_PRINT_ROWS, MAX_PRETTY_PRINT_DEPTH } from './render-budgets';

interface Atom {
  text: string;
  start: number;
  end: number;
  structural: boolean;
}

export interface PrettyPrintCache {
  yamlContent: string | null;
  yamlLines: Map<number, Atom[]>;
}

export function createPrettyPrintCache(): PrettyPrintCache {
  return { yamlContent: null, yamlLines: new Map() };
}

// YAML의 일반/따옴표/블록 문자열은 기존 강조 토큰보다 정확한 어휘 경계로 보호한다.
function getYamlAtoms(content: string, cache: PrettyPrintCache): Map<number, Atom[]> {
  if (cache.yamlContent === content) return cache.yamlLines;
  const lines = new Map<number, Atom[]>();
  let offset = 0;
  let line = 0;
  let scalar = false;
  for (const text of new Lexer().lex(content)) {
    if (text === CST.DOCUMENT || text === CST.FLOW_END) continue;
    if (text === CST.SCALAR) {
      scalar = true;
      continue;
    }
    if (text.trim().length > 0) {
      const atoms = lines.get(line) ?? [];
      atoms.push({ text, start: offset, end: offset + text.length,
        structural: !scalar && /^[\[\]{},:]$/.test(text) });
      lines.set(line, atoms);
    }
    offset += text.length;
    line += text.split('\n').length - 1;
    scalar = false;
  }
  cache.yamlContent = content;
  cache.yamlLines = lines;
  return lines;
}

interface RowStart { start: number; depth: number }

function getCollectionRows(atoms: Atom[]): RowStart[] | null {
  const significant = atoms.filter(atom => atom.text.trim().length > 0);
  const stack: string[] = [];
  const rows: RowStart[] = [];
  const breakBefore = (index: number, depth: number) => {
    const next = significant[index];
    if (next && rows.at(-1)?.start !== next.start) rows.push({ start: next.start, depth });
  };
  for (let index = 0; index < significant.length; index += 1) {
    const atom = significant[index];
    if (!atom.structural) continue;
    const next = significant[index + 1];
    if (atom.text === '{' || atom.text === '[') {
      stack.push(atom.text === '{' ? '}' : ']');
      if (stack.length > MAX_PRETTY_PRINT_DEPTH) return null;
      if (next && next.text !== stack.at(-1)) breakBefore(index + 1, stack.length);
    } else if (atom.text === '}' || atom.text === ']') {
      if (stack.pop() !== atom.text) return null;
      const previous = significant[index - 1];
      if (previous?.text !== (atom.text === '}' ? '{' : '[') || !previous.structural) {
        breakBefore(index, stack.length);
      }
    } else if (atom.text === ',' && stack.length && next?.text !== stack.at(-1)) {
      breakBefore(index + 1, stack.length);
    }
    if (rows.length >= MAX_PRETTY_PRINT_ROWS) return null;
  }
  // 완성된 한 줄 구조만 펼친다. 입력 중 괄호가 깨지면 기존 표시로 돌아간다.
  return stack.length === 0 && rows.length > 0 ? rows : null;
}

interface XmlPart {
  start: number;
  end: number;
  kind: 'open' | 'close' | 'empty' | 'markup' | 'text';
  name?: string;
  parent?: XmlPart;
  mixed?: boolean;
  children?: boolean;
  depth: number;
}

function getXmlRows(tokens: Token[]): RowStart[] | null {
  const parts: XmlPart[] = [];
  const stack: XmlPart[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const text = token.text ?? '';
    if (!text.trim()) continue;
    let kind: XmlPart['kind'] = token.type === 'comment' ? 'markup' : 'text';
    let end = token.end!;
    let name: string | undefined;
    if (token.type === 'punctuation' && ['<', '</', '<?', '<!', '<![CDATA['].includes(text)) {
      const terminator = text === '<?' ? '?>' : text === '<![CDATA[' ? ']]>' : '>';
      kind = text === '<' ? 'open' : text === '</' ? 'close' : text === '<![CDATA[' ? 'text' : 'markup';
      let closed = false;
      for (index += 1; index < tokens.length; index += 1) {
        const next = tokens[index];
        if (next.type === 'tag') name = next.text;
        if (next.type === 'punctuation' && (next.text === terminator || next.text === '/>')) {
          end = next.end!;
          if (next.text === '/>') kind = 'empty';
          closed = true;
          break;
        }
      }
      if (!closed) return null;
    }
    const parent = stack.at(-1);
    const part: XmlPart = { start: token.start!, end, kind, name, parent, depth: stack.length };
    if (kind === 'close') {
      const opening = stack.pop();
      if (!opening || opening.name !== name) return null;
      part.parent = opening;
      part.depth = stack.length;
    } else if (kind === 'text') {
      if (parent) parent.mixed = true;
      else return null;
    } else {
      if (parent) parent.children = true;
      if (kind === 'open') stack.push(part);
    }
    parts.push(part);
    if (stack.length > MAX_PRETTY_PRINT_DEPTH || parts.length > MAX_PRETTY_PRINT_ROWS * 4) return null;
  }
  if (stack.length) return null;
  const rows: RowStart[] = [];
  for (const part of parts) {
    if (part.kind === 'text') continue;
    let parent = part.parent;
    let inline = false;
    while (parent) {
      if (parent.mixed) { inline = true; break; }
      parent = parent.parent;
    }
    if (inline || (part.kind === 'close' && !part.parent?.children)) continue;
    if (part !== parts[0]) rows.push({ start: part.start, depth: part.depth });
    if (rows.length >= MAX_PRETTY_PRINT_ROWS) return null;
  }
  return rows.length ? rows : null;
}

function splitRows(line: ParsedLine, starts: RowStart[], tabSize: number): PrettyPrintRow[] {
  const first = line.tokens[0].start!;
  const last = line.tokens.at(-1)!.end!;
  const boundaries = [{ start: first, depth: 0 }, ...starts.filter(row => row.start > first)];
  const rows: PrettyPrintRow[] = [];
  let tokenIndex = 0;
  for (let index = 0; index < boundaries.length; index += 1) {
    const row = boundaries[index];
    const end = boundaries[index + 1]?.start ?? last;
    const tokens: Token[] = [];
    while (tokenIndex < line.tokens.length) {
      const token = line.tokens[tokenIndex];
      if (token.start! >= end) break;
      const start = Math.max(row.start, token.start!);
      const tokenEnd = Math.min(end, token.end!);
      tokens.push({ ...token, start, end: tokenEnd,
        text: token.text!.slice(start - token.start!, tokenEnd - token.start!) });
      if (token.end! > end) break;
      tokenIndex += 1;
    }
    rows.push({ start: row.start, end, tokens,
      indentColumns: index === 0 ? 0 : line.indentColumns + row.depth * tabSize });
  }
  return rows;
}

export function applyStructuredPrettyPrint(
  content: string, format: string, lines: ParsedLine[], tabSize: number,
  cache = createPrettyPrintCache()
): ParsedLine[] {
  if (!['json', 'jsonc', 'jsonlines', 'yaml', 'toml', 'xml'].includes(format)) return lines;
  // 공백 보존을 요청한 XML 문서는 조상 요소가 화면 밖에 있어도 보수적으로 유지한다.
  if (format === 'xml' && /\bxml:space\s*=\s*(['"])preserve\1/.test(content)) return lines;
  const yamlLines = format === 'yaml' ? getYamlAtoms(content, cache) : null;
  return lines.map(line => {
    if (line.lineKind === 'section' || !line.tokens.length || line.tokens.some(token =>
      token.type === 'invalid' || token.children || token.start === undefined || token.end === undefined
    )) return line;
    const first = line.tokens[0].start!;
    const last = line.tokens.at(-1)!.end!;
    const atoms = yamlLines ? (yamlLines.get(line.id) ?? []) : line.tokens.flatMap(token => {
      const text = token.text ?? '';
      const structural = ['brace', 'bracket', 'punctuation'].includes(token.type);
      return structural && /^[\[\]{},:]+$/.test(text)
        ? Array.from(text, (text, index) => ({ text, start: token.start! + index,
            end: token.start! + index + 1, structural: true }))
        : [{ text, start: token.start!, end: token.end!, structural: false }];
    });
    if (atoms.some(atom => atom.start < first || atom.end > last)) return line;
    const starts = format === 'xml' ? getXmlRows(line.tokens) : getCollectionRows(atoms);
    return starts ? { ...line, prettyRows: splitRows(line, starts, tabSize) } : line;
  });
}

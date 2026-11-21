import { parseMarkdownRichBlocks, type MarkdownRichBlock } from './markdown-rich-text';
import { parseMarkdownTables, type MarkdownTableBlock } from './markdown-table';
import { MAX_INTERACTIVE_TABLE_CELLS } from './render-budgets';
import { isTextChangeTransition, type TextChange } from './text-change';

export interface MarkdownPresentation {
  blocks: MarkdownRichBlock[];
  regions: MarkdownRichBlock[];
  tables: MarkdownTableBlock[];
  environment: Record<string, unknown>;
}

function containingRegion(regions: MarkdownRichBlock[], start: number, end: number): MarkdownRichBlock | undefined {
  let low = 0, high = regions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (regions[middle].start <= start) low = middle + 1;
    else high = middle;
  }
  const region = regions[low - 1];
  return region && end <= region.end ? region : undefined;
}

const plainParagraphSyntaxPattern = /[<!&\[*_~@:=]|^ {0,3}(?:[>\-#+]|\d+[.)][ \t])|^(?: {4}|\t)|\S\.\S/mu;
const blockLeadingSyntaxPattern = /^ {0,3}(?:#|\d+[.)][ \t]|[>\-+*])|^(?: {4}|\t)/u;

/** 활성 문서 하나의 해석 결과만 보관한다. 구조/참조 정의 변경은 전체 해석한다. */
export class MarkdownPresentationCache {
  private content: string | null = null;
  private value: MarkdownPresentation = { blocks: [], regions: [], tables: [], environment: {} };
  // 일반 목록을 국소 해석에만 사용한다. 줄 편집 방식과 표시 결과에는 노출하지 않는다.
  private localLists: MarkdownRichBlock[] = [];
  inspectedCharacters = 0;

  clear(): MarkdownPresentation {
    this.content = null;
    this.localLists = [];
    return this.value = { blocks: [], regions: [], tables: [], environment: {} };
  }

  get(content: string, lineStarts: number[], change?: TextChange | null): MarkdownPresentation {
    if (content === this.content) return this.value;
    const previous = this.value;
    const old = this.content;
    this.content = content;
    this.inspectedCharacters = content.length;
    // 문단 내부의 문자 수정은 줄/블록 경계를 바꾸지 않는다. 마크업, 참조 정의,
    // 빈 줄 및 줄 추가/제거는 이 빠른 경로를 쓰지 않는다.
    if (old !== null && change
      && !/[\r\n<>\[\]`~*+_\\|:#!=\-]/u.test(change.beforeText + change.afterText)
      && isTextChangeTransition(old, content, change)) {
      const end = change.rangeStart + change.beforeText.length;
      const list = containingRegion(this.localLists, change.rangeStart, end);
      const region = containingRegion(previous.regions, change.rangeStart, end) ?? list;
      if (region && !region.listChunk && region.source.length < 128 * 1024 && !/\]:|\|/u.test(region.source)) {
        const delta = change.afterText.length - change.beforeText.length;
        const sourceEnd = region.end + delta;
        const source = content.slice(region.start, sourceEnd);
        const lineStart = old.lastIndexOf('\n', change.rangeStart - 1) + 1;
        const beforeEdit = old.slice(region.start, change.rangeStart);
        const insideTag = beforeEdit.lastIndexOf('<') > beforeEdit.lastIndexOf('>');
        const wasRich = previous.blocks.includes(region);
        // 줄의 첫 단어를 없애거나 앞에 붙이면 목록/블록의 시작 여부가 바뀔 수 있다.
        // 일반 문단에서 블록 표식이나 4칸 들여쓰기를 만들지 않는 줄 시작 조합·편집은 국소 경로를 유지한다.
        let canLocalLineStart = Boolean(old.slice(lineStart, change.rangeStart).trim());
        if (!canLocalLineStart && !wasRich && !list) {
          const oldLineEnd = old.indexOf('\n', lineStart);
          const oldLine = old.slice(lineStart, oldLineEnd === -1 ? old.length : oldLineEnd).replace(/\r$/u, '');
          const newLineEnd = content.indexOf('\n', lineStart);
          const newLine = content.slice(lineStart, newLineEnd === -1 ? content.length : newLineEnd).replace(/\r$/u, '');
          canLocalLineStart = Boolean(newLine.trim())
            && !blockLeadingSyntaxPattern.test(oldLine)
            && !blockLeadingSyntaxPattern.test(newLine);
        }
        if (!insideTag && canLocalLineStart) {
          // 마지막 빈 줄을 포함하는 목록은 그 줄의 줄바꿈까지 해석해야 같은 끝 줄을 얻는다.
          const ending = content.startsWith('\r\n', sourceEnd) ? 2 : content[sourceEnd] === '\n' ? 1 : 0;
          const localSource = content.slice(region.start, sourceEnd + ending);
          const isUnformattedPlainParagraph = !wasRich && !list
            && source.trim().length > 0
            && !plainParagraphSyntaxPattern.test(source)
            && source.split(/\r?\n/u).every(line => line.trim().length > 0);
          let localMatched = isUnformattedPlainParagraph;
          if (!localMatched) {
            const localStarts = [0];
            for (let i = 0; i < localSource.length; i++) if (localSource[i] === '\n') localStarts.push(i + 1);
            const localLists: MarkdownRichBlock[] = [];
            const localRegions: MarkdownRichBlock[] = [];
            const next = parseMarkdownRichBlocks(localSource, localStarts, { ...previous.environment }, localRegions, localLists, true);
            const local = wasRich ? next : list ? localLists : localRegions;
            // 표시 종류, 블록의 끝 또는 500개 표시 한도에 영향을 주면 전체 해석한다.
            localMatched = next.length === Number(wasRich) && local.length === 1
              && local[0].start === 0 && local[0].end === source.length;
          }
          if (localMatched) {
            const replacement = { ...region, end: sourceEnd, source };
            const shift = (block: MarkdownRichBlock): MarkdownRichBlock => block === region ? replacement
              : block.start <= region.end || !delta ? block : {
                ...block, start: block.start + delta, end: block.end + delta,
                ...(block.listChunk && { listChunk: { ...block.listChunk,
                  listStart: block.listChunk.listStart + delta, listEnd: block.listChunk.listEnd + delta } })
              };
            this.inspectedCharacters = source.length;
            this.localLists = this.localLists.map(shift);
            const blocksChanged = wasRich || (delta !== 0 && previous.blocks.some(block => block.start > region.end));
            const blocks = blocksChanged ? previous.blocks.map(shift) : previous.blocks;
            const shiftedRichBlocks = blocksChanged
              ? new Map(previous.blocks.map((block, index) => [block, blocks[index]]))
              : null;
            const tablesChanged = delta !== 0 && previous.tables.some(table => table.start > region.end);
            const tables = tablesChanged ? previous.tables.map(table => table.start > region.end ? {
              ...table, start: table.start + delta, end: table.end + delta,
              cells: table.cells.map(row => row.map(cell => ({ ...cell, start: cell.start + delta, end: cell.end + delta, offsets: cell.offsets.map(offset => offset + delta) })))
            } : table) : previous.tables;
            return this.value = {
              environment: previous.environment,
              blocks,
              regions: previous.regions.map(block => shiftedRichBlocks?.get(block) ?? shift(block)),
              tables
            };
          }
        }
      }
    }
    let environment: Record<string, unknown> = {};
    const regions: MarkdownRichBlock[] = [];
    this.localLists = [];
    const blocks = parseMarkdownRichBlocks(content, lineStarts, environment, regions, this.localLists);
    // 같은 참조 정의로 해석한 블록은 원문이 그대로라면 HTML도 그대로 둔다.
    if (JSON.stringify(environment.references) === JSON.stringify(previous.environment.references)) {
      environment = previous.environment;
      for (const block of regions) block.environment = environment; // blocks도 같은 객체를 공유한다.
      for (const list of this.localLists) list.environment = environment;
    }
    const tables = parseMarkdownTables(content, lineStarts, MAX_INTERACTIVE_TABLE_CELLS)
      .filter(table => !blocks.some(block => block.startLine <= table.endLine && block.endLine >= table.startLine));
    return this.value = { blocks, tables, regions, environment };
  }
}

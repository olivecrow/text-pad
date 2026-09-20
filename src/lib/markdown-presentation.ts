import { parseMarkdownRichBlocks, type MarkdownRichBlock } from './markdown-rich-text';
import { parseMarkdownTables, type MarkdownTableBlock } from './markdown-table';
import { MAX_INTERACTIVE_TABLE_CELLS } from './render-budgets';
import type { TextChange } from './text-change';

export interface MarkdownPresentation {
  blocks: MarkdownRichBlock[];
  regions: MarkdownRichBlock[];
  tables: MarkdownTableBlock[];
  environment: Record<string, unknown>;
}

/** 활성 문서 하나의 해석 결과만 보관한다. 구조/참조 정의 변경은 전체 해석한다. */
export class MarkdownPresentationCache {
  private content: string | null = null;
  private value: MarkdownPresentation = { blocks: [], regions: [], tables: [], environment: {} };
  inspectedCharacters = 0;

  clear(): MarkdownPresentation {
    this.content = null;
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
    if (old !== null && change && old.length + change.afterText.length - change.beforeText.length === content.length
      && !/[\r\n<>\[\]`~*_\\|:#!=\-]/u.test(change.beforeText + change.afterText)
      && old.slice(0, change.rangeStart) + change.afterText + old.slice(change.rangeStart + change.beforeText.length) === content) {
      const end = change.rangeStart + change.beforeText.length;
      const region = previous.regions.find(item => item.start < change.rangeStart && item.end >= end);
      if (region && region.source.length < 128 * 1024 && !/^ {0,3}\[[^\]]+\]:/mu.test(region.source)) {
        const delta = change.afterText.length - change.beforeText.length;
        const source = content.slice(region.start, region.end + delta);
        const oldLine = old.slice(old.lastIndexOf('\n', change.rangeStart - 1) + 1, end);
        const beforeEdit = old.slice(region.start, change.rangeStart);
        const insideTag = beforeEdit.lastIndexOf('<') > beforeEdit.lastIndexOf('>');
        if (!insideTag && source.trim() && oldLine.trim() && source.split(/\r?\n/u).every(line => line.trim())) {
          const localStarts = [0];
          for (let i = 0; i < source.length; i++) if (source[i] === '\n') localStarts.push(i + 1);
          const next = parseMarkdownRichBlocks(source, localStarts, { ...previous.environment });
          const current = previous.blocks.filter(block => block.start >= region.start && block.end <= region.end);
          // 블록 수가 바뀌면 500개 표시 한도 뒤의 블록까지 다시 결정한다.
          if (next.length === current.length) {
            const shift = (block: MarkdownRichBlock): MarkdownRichBlock => block.end < region.start ? block
              : block.start > region.end ? { ...block, start: block.start + delta, end: block.end + delta }
              : { ...block, end: block.end + delta, source, environment: previous.environment };
            this.inspectedCharacters = source.length;
            return this.value = {
              environment: previous.environment,
              blocks: previous.blocks.map(shift),
              regions: previous.regions.map(shift),
              tables: previous.tables.map(table => table.start > region.end ? {
                ...table, start: table.start + delta, end: table.end + delta,
                cells: table.cells.map(row => row.map(cell => ({ ...cell, start: cell.start + delta, end: cell.end + delta, offsets: cell.offsets.map(offset => offset + delta) })))
              } : table)
            };
          }
        }
      }
    }
    const environment = {};
    const regions: MarkdownRichBlock[] = [];
    const blocks = parseMarkdownRichBlocks(content, lineStarts, environment, regions);
    const tables = parseMarkdownTables(content, lineStarts, MAX_INTERACTIVE_TABLE_CELLS)
      .filter(table => !blocks.some(block => block.startLine <= table.endLine && block.endLine >= table.startLine));
    return this.value = { blocks, tables, regions, environment };
  }
}

# Natural Text Editing Guidelines

[한국어](natural-text-editing.md)

This document defines behavioral guidelines for editors that provide syntax highlighting or structured presentation while remaining as predictable as a plain text editor. It is based on the current editing contract of the `text-pad` render mode and is written so the same principles can be applied to desktop applications and web services.

In this document, source text means the actual string that is saved, while the rendered layer means syntax highlighting and structural presentation drawn over that source. The caret indicates where the next character will be inserted, and the selection is the source range that the next edit will replace.

## Goals

Natural editing is not editing with the most features. It is editing that does not violate the user's expectation of what happens next.

- Input must appear at the same location in both the visible editor and the saved source text.
- Even when the application assists a single key press by inserting or removing multiple characters, the user must experience the complete result as one action.
- The caret and selection must retain the same semantic position before and after an edit.
- When an assistance rule does not apply, the editor must safely fall back to the operating system and input element's default behavior.
- The rendered layer must never normalize or rewrite source text without an explicit edit from the user.

## Rendered layout and pointer selection

- When measured visible-line heights increase the document height at the scroll bottom, preserve the bottom position. Do not force a return to the bottom after the user scrolls upward or the editor viewport changes.
- When rendered lines or tables enter or leave the viewport during scrolling, browser selection notifications must not scroll back to the caret if the source selection range is unchanged. Wheel input anywhere in the editor, including table cells, also cancels a pending caret reveal after editing. Subsequent actual keyboard navigation, clicks, and edits reveal the input position again.

- During continuous window-width changes, visible text immediately wraps at the current width. Keep syntax highlighting and line numbers visible, and update line positions, the caret, and selection backgrounds from actual displayed-line heights and text coordinates. Preserve source text and selection offsets. Only offscreen estimates and full-document wrapping in the transparent input wait until width changes stop for 80ms; synchronize the input width before pointer presses, keyboard navigation, text input, or composition starts. Height-only changes must not delay the pending width update.

- Render mode wraps at character boundaries to use the remaining width. Hyphens and syntax token boundaries are not separate preferred wrapping points. Source newlines remain unchanged.
- The actual height of each displayed line determines subsequent line positions, line numbers, and scroll extent. After content or presentation changes, remeasure displayed lines even when their dimensions are unchanged. Offscreen estimates are not authoritative heights for displayed lines.
- Clicks, Shift-clicks, and both drag endpoints map visible rendered text to source offsets. Selection does not use the transparent input element's separate wrapping geometry. Backward selection and drag autoscrolling outside the viewport are supported.
- Double-click word selection also starts from the rendered text position. Selection backgrounds and the caret use the same rendered ranges; browsers without custom highlights use actual text rectangles for selection backgrounds.
- Show the selection background throughout a drag, before the pointer button is released. Update the endpoint from pointer movement events, and do not repeatedly cancel a pending paint. Use the current theme’s selection background color.
- Clicking and dragging do not change source text or undo history. Subsequent typing and undo use the existing source-offset conversion and edit history paths.

## Soft wrapping of keys and values

- In render mode, lines recognized by the syntax parser as a key, separator, and value align subsequent display rows with the value start. This also applies to ENV `export API_URL = value`, INI, Properties, TOML, and JSON/YAML key/value rows. Do not reinterpret `=` or `:` inside strings or comments as separators.
- Measure actual displayed widths, including fonts, tabs, and separator spacing, and remeasure after width or setting changes. Use ordinary wrapping if the value does not start on the first display row or the prefix exceeds 80% of the row width.
- Consecutive and trailing spaces each occupy width and wrap onto subsequent display rows. Added display indentation and soft wraps do not change source text, copying, saving, or undo history. Clicks, drags, Up/Down, Home/End, and Shift selection follow actual displayed positions. Preserve default source-mode editing.

## Display-only formatting of structured data

- Complete structures within one source line are automatically arranged into display rows in render mode: JSON/JSONC/JSON Lines objects and arrays, YAML flow collections, TOML arrays and inline tables, and XML elements. Line numbers, diagnostics, and JSON Lines record boundaries remain based on source text.
- Display line breaks, configured indentation, and spacing after colons do not insert or replace source characters. For example, `{"items":[1,2]}` appears as follows on screen while copying or saving still produces the original single line.

```json
{
    "items": [
        1,
        2
    ]
}
```

- Do not split structural symbols inside strings or comments. Preserve YAML block/multiline scalars, TOML multiline strings, and XML character data, CDATA, and mixed content. Skip expansion for XML documents containing `xml:space="preserve"`.
- Clicks, drags, selection highlights, and the caret share the same source offsets. Within expanded lines and adjacent source lines, Up/Down, Home/End, PageUp/PageDown, and Shift selection follow actual display rows. At a source boundary shared by two display rows, show the caret at the chosen preceding row end or following row start. Ctrl combinations retain existing document navigation.
- Typing, deletion, and pasting affect only the selected source range and use existing undo history. Formatting and mode switches create neither dirty state nor undo entries. Source mode and formats with rendering disabled do not expand structures.
- Incomplete or mismatched structures, and lines exceeding 2,000 display rows or 64 nesting levels, retain the basic presentation. CSV/TSV keep their existing tables; do not arbitrarily expand plain text, logs, or INI-like formats with meaningful line boundaries. On narrow windows, cap indentation at 60% of the display row width and remeasure actual heights.

## Core principles

### Use source text as the single source of truth

- Saving, undo, redo, selections, and dirty-state tracking are always based on source text.
- Syntax highlighting, indentation guides, soft wrapping, and virtualization are derived from source text.
- Display-only soft wrapping must not insert newline characters into source text.
- Change only the range the user explicitly edits. Do not normalize whitespace, newlines, delimiters, or quotation marks across the document as a convenience.

### Treat user actions as atomic transactions

- Even if one key press inserts or removes multiple characters, one Undo command must revert the complete result.
- Capture the source text and selection before the edit, then record the final source text and selection once after the feature finishes.
- Do not expose intermediate calculation states as separate Undo steps.
- An action that does not change source text must not create an Undo record.

### Preserve the meaning of the caret and selection

- Adding indentation before a line must leave a caret in the body between the same two characters.
- If the length of a list marker changes, preserve caret and selection positions relative to the body text.
- When multiple selected lines are transformed, update the selection to account for prefixes that were added or removed.
- Undo and Redo must restore not only source text, but also the caret and selection from before and after the edit.

### Define clear boundaries for editing assistance

- In `text-pad`, editing assistance intercepts key input only in render mode.
- Source mode uses the default Tab, Backspace, Enter, bracket, and quotation-mark behavior of the HTML `textarea` multiline input element.
- Decide whether render mode is active once in the top-level input path. Lower-level transformation functions should only calculate their own edit when called.
- Render-mode editing assistance must not intervene during IME composition, including Korean text composition.
- General character assistance must not intercept operating-system or application shortcuts combined with Ctrl, Alt, or Meta, the macOS Command key.

## Automatic character pairing

Automatic pairing inserts a closing character when the user types an opening character, then places the caret between the pair.

The current pairs are:

| Opening character | Closing character |
| --- | --- |
| `(` | `)` |
| `[` | `]` |
| `{` | `}` |
| `"` | `"` |
| `'` | `'` |
| `` ` `` | `` ` `` |

The behavioral contract is:

- Apply pairing only when the setting is enabled and there is a collapsed caret with no selection.
- Create a new automatic pair only when the caret is at the end of the text or the text to its right begins with whitespace or a configured exception string. Whitespace is always an exception and cannot be removed. The default configurable exception strings are `=` and `:`; users can add or remove other strings in the render-mode editing settings.
- In an allowed right-side context, typing one opening character inserts both characters and moves the caret between them. When disallowed text is to the right, automatic pairing does not intervene and the `textarea` default behavior inserts only the typed character.
- If the character at the caret is the same closing bracket, quote, or backtick that the user types, leave the source unchanged and move the caret past that character. Typing `"` twice therefore leaves only `""` with the caret after the closing quote.
- When three backticks are typed after optional indentation at the start of a line and the right-side context allows a new automatic pair, the third input expands them into an opening fence, an empty code line, a closing fence, and a following line with the same indentation, while leaving the caret inside the empty code line. A collapsed caret immediately after the closing fence maps to the first editable position on the following line instead of the hidden fence line. Preserve the existing newline convention and indentation.
- With an active selection, the current implementation does not wrap the selection and instead uses default input behavior. Selection wrapping requires a separate behavioral contract and validation before it can be added.
- Pressing Backspace between an empty automatic pair removes both the opening and closing characters.
- In repeated-character contexts such as `"""` or `(()`, do not guess that surrounding characters belong to the same pair when an outer closing character cannot be confirmed.
- Automatic insertion, paired deletion, and backtick code-block expansion are each one Undo action. Skipping over a closing character does not change source text and therefore creates no Undo record.
- In render mode, hidden inline backticks and fenced-code delimiter lines are not collapsed-caret stops. Pointer and arrow-key movement skips to a visible inline-code boundary or to an adjacent editable line inside or outside the fenced block.
- Pressing Backspace within the leading whitespace of the line immediately after a closing fence keeps the code content and line structure, but reduces each run of opening and closing backticks to two characters so only fenced-block syntax is disabled. Place the caret immediately after the two remaining closing backticks, at the position where the removed backticks were. Selection deletion that includes both fences and the complete block remains allowed. Disabling the fences is one Undo action.

## Highlighting paired brackets and quotation marks

In render mode, the editor shows the other end of the paired character touching the caret so the active editing boundary is immediately visible.

- The supported pairs are parentheses `()`, square brackets `[]`, braces `{}`, double quotation marks `""`, and single quotation marks `''`. Backticks remain part of the separate inline and fenced-code behavior, while `< >` is excluded because it conflicts with comparisons and tags.
- With a collapsed caret and editor focus, if the supported character immediately before or after the caret belongs to a complete pair, highlight both the opening and closing character. When two adjacent pairs touch the same caret position, prefer the inner boundary immediately after an opener or immediately before a closer.
- Brackets may match across lines, but their type and nesting order must agree. Do not guess a pair for mismatched or unclosed brackets, and do not treat brackets inside a complete quoted string as structural brackets.
- Double and single quotation marks require a closing mark on the same line and honor backslash escapes. An apostrophe used inside a word for contraction or possession is not treated as a paired quotation mark.
- Clear the pair highlight when a selection is created, the editor loses focus, or source mode is activated. Draw only ranges that are currently visible; when a virtualized opposite end enters the viewport, render it again from the same source offset.
- This feature is presentation-only and does not change source text, the caret, the selection, or undo history.

## Editing Markdown headings

- In render-enabled `.md` and `.markdown` documents, recognize `# ` through `###### ` after no more than three leading spaces as heading levels 1 through 6.
- In render mode, when a collapsed caret is immediately after `#` through `######` at the start of a line, pressing Space inserts one space and immediately applies that heading level. For example, pressing Space in `##|Heading` produces `## |Heading` and renders a level 2 heading. Here `|` represents the caret.
- When a complete existing heading marker, including its trailing whitespace, is immediately right of the caret, the newly typed marker replaces the existing level. For example, after typing `#` before an existing level 3 heading to form `#|### Existing heading`, pressing Space produces `# |Existing heading` and applies level 1.
- While replacing an existing heading level, keep the caret before the hidden old marker so the user can type up to six consecutive hashes. Release this temporary replacement position when an edit other than Space or a caret movement begins.
- The default setting hides the leading heading marker, but keeps the same source range as hidden syntax so source text and selections remain stable. Do not hide or reinterpret the same markers inside a fenced code block.
- Per-level size and weight, marker visibility, and level 1 and 2 dividers are shared display settings for every Markdown document. Changing them alters neither source text nor Undo history.
- Typing `#` itself remains ordinary character input. Applying a heading or replacing an existing level with Space keeps the new heading marker and space as Markdown source, and records the complete Space input and old-marker replacement as one Undo action.
- Do not intercept heading application when there is an active selection, IME composition is in progress, Ctrl, Alt, or Meta is pressed, the marker is not after no more than three leading spaces at line start, there are seven or more hashes, the line is inside a fenced code block, or the editor is in source mode.
- Pointer placement, arrow movement, and selection on a heading map the actual rendered glyph widths back to source positions. Do not leave a collapsed caret trapped inside a hidden marker range.
- Links, emphasis, and inline code inside a heading keep their exact source ranges, and saved text never receives display-only size, weight, color, or divider data.

## Markdown tables

- Render body tables with consecutive header and pipe-delimiter rows using the same cell, row, and column editor as CSV/TSV. Place the table directly in the document without a separate format label, toolbar, or enclosing border. Rendering and mode changes do not modify source text. Keep tables inside code, comments, or lists, and tables exceeding the budget, as source text; display tables inside blockquotes as part of their preview.
- Map cell selection and caret boundaries to actual source positions, including escaped pipes, character references, and `<br>` line breaks. Editing an existing cell changes only its content range, preserving surrounding prose and other cells' whitespace and delimiters. Row and column operations normalize only that table range while preserving its newline style and column alignment.
- Merge consecutive input only within the same table and cell; record each row or column operation independently. Undo and redo restore both source text and cell selection. Do not intercept cell-navigation keys during IME composition.
- `Tab`/`Shift+Tab` move between cells and leave the last/first cell for the following/preceding prose. `Escape` leaves for the following prose; ArrowUp at the start of the first row and ArrowDown at the end of the last row leave in their respective directions. `Ctrl+Home`/`Ctrl+End` also leave for the preceding/following prose. If no prose line exists at the document boundary, create one empty line and record it as an independent undo step.
- Tables fill the available body width with a minimum of 500 pixels; narrower regions scroll horizontally within the table. Cells wrap to their width without internal scrolling, including breaks within long words. Each row and its inputs grow or shrink to fit the tallest cell. Window or column resizing and visual wrapping alone add neither source newlines nor Undo records. Apply this layout to the shared CSV/TSV editor as well.
- Allocate column widths in proportion to the square root of each column's total character count, including headers but excluding newlines. Soften a 1:16 character-count ratio to a 1:4 width ratio so shorter columns do not become excessively narrow. Keep each column at least 100 pixels wide and distribute the remaining space among the other columns using their adjusted proportions. Use equal widths for an entirely empty table; if there are too many columns to fit their minimum widths, widen the table and scroll horizontally. Recalculate after content edits until the user adjusts widths manually, then prioritize the manual proportions and minimum width without applying the square-root adjustment. Width changes affect neither source text nor Undo history.
- The table's full height determines subsequent prose positions and scroll extent; long tables scroll vertically with the document. Source selections and copying started outside the table include its source string. Within cells, use the shared table editor's text selection. Keep emphasis and link syntax as editable Markdown strings in cells.
- Example: `| 품목 | 수량 |` followed by `| :--- | ---: |` and `| 연필 | 2 |` produces a two-column table aligned left/right. Replacing `연필` with `연필 세트` preserves other cells and surrounding prose; one undo restores `연필`.

## Markdown formatting and HTML

- Hide bold, italic, and strikethrough markers on ordinary lines while retaining their source offsets; clicking visible text edits at that position and supports Undo.
- Interpret `**bold *nested italic* end**`, `*italic **nested bold** end*`, `***both***`, and emphasis inside quotation marks. Keep intraword underscores, escaped asterisks, unmatched markers, and markers with adjacent inner whitespace literal. Emphasis markers inside inline or fenced code remain text.
- Consecutive `>` lines form one quote area with a left border; a bare `>` separates internal paragraphs and `> >` creates a nested quote. Render emphasis, lists, tables, and code within the quote; use Markdown paragraph boundaries for lazy continuation lines and the end of the area. Edit quotes and multiline emphasis through the rich block's source-mode transition, preserving source newlines.
- Render paragraphs containing HTML, images, links, or character references, and horizontal rules, as safe rich previews. Example: `<p align="center"><strong>Title</strong><br><sub>Description</sub></p>`.
- The `‹/›` button or a double-click on a rich block switches to source mode and selects that block's exact source. If keyboard input starts inside a rich block, reveal source mode before editing. Never estimate source offsets from preview text length.
- Apply the actual height of `<details><summary>More</summary>…</details>` disclosure changes, image loading, and width changes to following paragraphs and scroll extent. Disclosure state and source-mode switching change neither source text nor Undo history.
- Keep tags inside code literal. Never execute document scripts, events, or arbitrary styles. Tables inside rich HTML or blockquotes remain part of their preview; other Markdown tables retain the existing cell editor.

## Rendered line checkboxes

- In plain-text and Markdown documents, start rendering an unchecked or checked checkbox when the first content after optional leading indentation is `[]` or `[V]` and the marker is immediately followed by a literal Space (U+0020). Do not reinterpret the same strings inside a fenced code block.
- Treat bare `[]` and `[V]`, attached forms such as `[]body` and `[V]body`, and markers followed by a tab instead of a Space as ordinary source text. Only uppercase `V` is a checked marker; unsupported markers such as `[v]`, `[x]`, and `[ ]` also remain ordinary source text.
- Keep the marker's real source text node, but draw the checkbox inside a fixed visual width. Although `[]` and `[V]` have different source lengths, their final checkbox width, following body start, and gap must be identical, and wrapping and caret geometry use that final visual layout.
- Clicking a checkbox in render mode changes only that marker between `[]` and `[V]` and preserves the rest of the line exactly, including the required following Space. Do not intercept clicks or default text editing in source mode.
- Because the marker changes between two and three characters, move carets and selection endpoints after the marker by the length delta and clamp positions inside the marker to the new range.
- With a collapsed selection and the caret after the marker and required Space, plain `Enter` splits the current line at the caret and starts the next line with the same leading indentation and a new unchecked marker `[] `. Even when the current item is checked as `[V]`, the new item starts as `[] `.
- At the end of an empty item containing only leading indentation and `[] ` or `[V] `, plain `Enter` ends the checkbox list by removing the current marker and required Space instead of creating another item. Preserve the existing leading indentation. `Shift+Enter` remains an ordinary newline that does not create another checkbox.
- Automatic continuation and empty-item exit preserve the document's CRLF or LF newline style. Each check, uncheck, automatic continuation, or empty-item exit is one Undo transaction, and Undo and Redo restore both source text and selection.

## Indentation and outdentation

Treat Tab as a command that makes the current line structurally deeper, not as a character that inserts spaces at the caret.

- With no selection, indent the entire line containing the caret.
- With a selection, indent every line touched by the selection in one operation.
- One indentation level is currently four spaces.
- A completely blank source line with zero length is indented like any other line. Tab adds one indentation level and leaves the caret after it so the next text input starts at the indented position.
- Shift+Tab removes one leading tab or up to four leading spaces.
- Shift+Tab on a line with no leading whitespace changes neither source text nor Undo history.
- Move body-relative caret and selection positions by the prefix-length delta so they still point to the same place in the body.
- When Backspace is pressed inside leading indentation, remove whitespace back to the previous four-column boundary instead of deleting one space at a time. Remove one tab character at a time.
- Tab always applies to the entire line even when the caret is in the body and never inserts spaces in the middle of the body. Outside leading indentation, Backspace keeps its default deletion behavior.
- On a checkbox line, Tab and Shift+Tab add or remove only leading indentation while preserving the `[]` or `[V]` marker and its current checked state.
- Even when one Tab or Shift+Tab changes multiple lines and list markers, it remains one Undo action.

## List markers

### Recognition

A list marker starts after the line's leading whitespace and must be followed by at least one space or tab.

The current recognized forms are:

- Decimal: `1. `, `1) `, `(1) `
- Single Latin letter: `A. `, `a) `, `(a) `
- Valid Roman numeral: `I. `, `II. `, `iv. `
- Unordered marker: `- `, `* `, `+ `, `• `

`-`, `*`, and `+` are widely used lightweight-markup markers, while `•` is common in ordinary documents. Whitespace between the marker and body is treated as part of the marker and preserved when continuing the list. Identical text in the middle of a line is not treated as a list marker.

### Rendered body cell and boundary editing

- In render mode, a recognized list line is laid out as a two-column grid with a marker cell and a body cell. The body cell is a real layout region with its own wrapping width, not text positioned by drawing spaces after the marker.
- Display every ordered and unordered list line with an additional left inset measured as four spaces in the active render font. Add this inset once to existing leading indentation and apply the same inset to soft-wrapped rows and `Shift+Enter` continuation lines. Do not add it to the source or continuation-line structural whitespace, and do not include it in mode conversion, copied or saved text, or Undo history.
- The visual inset contains no characters that a caret can visit or a selection can include. Clicking it maps to the body start of that visual row. On marker and continuation lines, draw only the outer indentation guides inherited from the preceding ordinary line; list nesting alone never creates guides. Deeper list items add no guides, while shallower items end the levels they leave. An unindented blank line or fenced code block ends inheritance, and the next ordinary line establishes its own indentation context. Inherited guides use the same document-left origin as ordinary lines. Draw all guides using the configured theme color at 50% opacity. Do not create a guide for the inset itself. Both off-screen height estimates and the actual body cell subtract this inset from the available wrapping width, while caret and selection placement follow the final rendered text geometry.
- If the browser reports a collapsed range at a soft-wrap boundary as the end of the preceding row, use the next glyph's left edge for caret and click geometry when that glyph actually starts the next visual row. Clicking the inset must not skip the first character.
- First-line body text, soft-wrapped display rows, and `Shift+Enter` continuation lines all use the same left edge of the body cell. Leading whitespace on a continuation line remains only as source-compatible structure and is neither editable body whitespace nor an indentation level in render mode, so it does not produce an indentation guide. Only outer guides inherited from the preceding ordinary line remain visible.
- Clicking the marker cell or the structural area of a continuation line clamps a collapsed caret to the body start. A collapsed caret cannot remain in that structural area, and `ArrowLeft` at a continuation body start moves to the previous line end without traversing structural spaces.
- Pressing `Backspace` at the body start of a marker line removes the marker's last visible character together with its following structural gap. Therefore `1. body` removes the period first and becomes `1body`, ending list treatment, while `• body` becomes `body` in one action.
- Pressing `Backspace` at a continuation body start removes the preceding newline and continuation structure together, joining the body to the previous line.
- Removing a marker-tail character and joining a continuation line are each one Undo action.

### Indentation depth and marker style

When a list line is indented or outdented, choose its marker style again from the target depth and marker family. Ordered markers use the following styles.

| Depth | Style | Example |
| ---: | --- | --- |
| 0 | Uppercase Roman numeral with a period | `I. Title1` |
| 1 | Uppercase Latin letter with a period | `A. Title2` |
| 2 | Decimal number with a period | `1. Title3` |
| 3 | Lowercase Roman numeral with a period | `i. Title4` |
| 4 | Lowercase Latin letter with a period | `a. Title5` |
| 5 | Decimal number with a right parenthesis | `1) Title6` |
| 6 | Lowercase Latin letter with a right parenthesis | `a) Title7` |
| 7 | Decimal number in parentheses | `(1) Title8` |
| 8 | Lowercase Latin letter in parentheses | `(a) Title9` |

From depth 9 onward, repeat decimal and lowercase Latin markers as a pair while cycling delimiters in this order:

1. Period: `1. `, `a. `
2. Right parenthesis: `1) `, `a) `
3. Parentheses: `(1) `, `(a) `
4. Return to the period

Unordered markers remain separate from ordered markers and cycle by depth in this order: `- `, `* `, `+ `, `• `. Return to `- ` at depth 4.

When tabs and spaces are mixed, calculate visual indentation using four-column tab stops. In both families, the target depth after the move takes precedence over the marker's previous style.

### Create the next item with Enter

- Apply automatic continuation only when the selection is collapsed and the caret is after the complete list marker.
- When the current line is an empty item containing only leading indentation and a list marker, with the caret at the line end, plain `Enter` ends the list by removing the marker and its following whitespace instead of creating another item.
- Ending the list does not insert another newline. A top-level item becomes an empty ordinary line; a nested item keeps only its existing leading indentation and places the caret after it.
- The resulting empty ordinary line is an automatic-sequence boundary, so existing following markers keep their numbers. `Shift+Enter` still creates a marker-free continuation line instead.
- Preserve the current indentation, delimiter, and whitespace following the marker.
- Increment decimal numbers, Latin letters, and Roman numerals to their next value.
- For an unordered list, reuse the current symbol for the next item at the same depth.
- A single-letter marker can be ambiguous between a Roman numeral and a Latin letter. First use the sequence of the immediately preceding line with the same indentation and delimiter; when there is no preceding clue, treat `I` and `i` as the start of a Roman sequence and other single letters as alphabetic.
- If the next marker cannot be calculated safely, do not guess or rewrite source text; fall back to the default Enter behavior.
- If body text exists after the caret, split the line and move that text after the new marker.
- When continuous following ordered items use the same indentation depth and delimiter, increment each of their markers by one. Continue looking for the next item at the same depth across deeper child items and `Shift+Enter` continuation lines without changing those intervening lines.
- End the automatic-sequence range at a blank line, an ordinary paragraph at the same or shallower depth, a different delimiter or unordered symbol at the same depth, or an already broken sequence. Do not rewrite source text beyond that boundary.
- Preserve the document's newline style: use Windows CRLF in a CRLF document and Unix LF in an LF document.

Example:

```text
1. before|after
2. second
3. third
```

Result after Enter:

```text
1. before
2. |after
3. second
4. third
```

The same rule applies to other delimiters.

```text
1) before|after
```

Result after Enter:

```text
1) before
2) |after
```

An unordered list continues with the same symbol.

```text
- before|after
- next
```

Result after Enter:

```text
- before
- |after
- next
```

Ending a list from an empty item with Enter:

```text
1. before
2. |
3. after
```

Result after Enter:

```text
1. before
|
3. after
```

Continuing the list, moving trailing body text, and renumbering following items together form one Undo action. Removing the marker from an empty item is a separate single Undo action.

### Break a line inside the same item with Shift+Enter

- When the selection is collapsed and the caret is after the complete list marker, `Shift+Enter` creates a continuation line in the same item without a new marker.
- Measure where the current item's body begins in the active render font and align the continuation line's leading whitespace to the nearest space boundary. Also account for the current tab width when leading indentation or marker spacing contains tabs.
- Move body text after the caret to the new continuation line without changing the numbers of following items.
- When plain `Enter` is pressed on a marker-free continuation line, search backward for an owning marker whose measured body start matches the current indentation, without crossing a blank line or a shallower ordinary paragraph.
- When an owner is found, create its next item and renumber continuous following items under the same automatic-sequence boundary rules. Otherwise, fall back to general indentation preservation.
- Pressing `Shift+Enter` again on a continuation line creates another marker-free continuation line with the same indentation.
- Preserve the current CRLF or LF newline style.

Example:

```text
1. before|after
2. next
```

Result after Shift+Enter:

```text
1. before
    |after
2. next
```

After entering body text on the continuation line, press Enter in this state:

```text
1. before
    continuation|
2. next
```

Result after Enter:

```text
1. before
    continuation
2. |
3. next
```

Creating a `Shift+Enter` continuation line and later pressing plain `Enter` on that line to create the next marker and renumber following items are each one Undo action.

## Enter and empty indented lines

Indented lines that are not list items should also retain their context when a new line is created.

- When the preserve-indentation-on-Enter setting is enabled, copy the current line's leading spaces and tabs to the new line.
- With an active selection, replace the selection with the newline and indentation in one operation.
- Pressing Backspace at the end of an otherwise empty, automatically indented line joins it to the previous line and moves the caret to the end of that line.
- Joining an empty indented line takes precedence over deleting one indentation level.
- A list `Shift+Enter` continuation takes precedence over automatic list continuation.
- Ending a list with plain `Enter` on an empty marker item takes precedence over automatic list continuation.
- Plain `Enter` on a list continuation line is first evaluated as creating the owning marker's next item.
- Direct list continuation, continuation-line item creation, and following-item renumbering take precedence over general indentation preservation.
- Each assisted Enter operation and empty-line join is its own single Undo action.

## Enter between JSON and JSONC delimiters

An empty JSON or JSONC object or array should expand into a structure ready for immediate content entry.

- In render-enabled and render-editable JSON or JSONC, when a collapsed caret is directly between structural braces `{|}` or brackets `[|]`, plain `Enter` expands the pair into three lines. Here `|` represents the caret.
- Keep the source before the opening delimiter on the current line. Put the caret on the second line after the current line's leading indentation plus one four-space indentation level. Move the closing delimiter and all source after the caret to the third line after the current line's original leading indentation.
- Preserve the document's CRLF or LF newline style. The one-level JSON interior indentation is a default behavior even when the general preserve-indentation-on-Enter setting is disabled.
- Do not apply this behavior to delimiters inside JSON strings or JSONC comments, or to mismatched or non-adjacent delimiters. JSON Lines, which must keep one JSON value per line, and source mode use default `textarea` newline behavior.
- Record delimiter expansion and final caret placement as one Undo action.

Example:

```json
{|}
```

Result after Enter:

```json
{
    |
}
```

## Context-aware substitutions

A string substitution should run only when the user enters a delimiter that confirms the intent to convert.

The current arrow substitutions apply after the user types a standalone trigger at the start of the document or after whitespace, then presses Space.

| Input | Result |
| --- | --- |
| `-> ` | `→ ` |
| `--> ` | `→ ` |
| `<- ` | `← ` |
| `<-- ` | `← ` |
| `<-> ` | `↔ ` |
| `<--> ` | `↔ ` |
| `==> ` | `⇒ ` |
| `<== ` | `⇐ ` |
| `<=> ` | `⇔ ` |
| `<==> ` | `⇔ ` |

- Do not convert a trigger in the middle of a word or attached to another character.
- Preserve one space after the substitution to represent the Space key the user pressed.
- Do not substitute when there is an active selection or an IME composition is in progress.
- Record the string replacement and trailing space together as one Undo action.

## Text duplication

`Ctrl+D` is the same duplication command in source mode and render mode while the editor has focus.

- With no selection, duplicate the entire source line containing the caret immediately below it. Move the caret to the same column on the duplicated line.
- When the current line already has a line ending, preserve that line's LF or CRLF. For the final line, insert the document's preferred line ending between the original and duplicate.
- With a single-line selection, insert only the selected string immediately after the selection and select the newly inserted copy. For example, duplicating the selected `BC` in `ABCD` produces `ABCBCD`.
- With a multi-line selection, do not expand to whole lines. Insert the exact selected source range, including any selected line endings, immediately after the selection and make the new copy the resulting selection.
- Do not intercept the shortcut during IME composition or while focus is outside the editor, such as in a settings input.
- Record the complete line or selection duplication as one independent Undo action. Undo and Redo restore the caret or selection from before and after the edit.

## Undo and Redo

An application with custom editing features should use one history system as the source of truth instead of mixing browser Undo history with application state.

`text-pad` uses a separate in-memory history for each tab.

- Each tab retains at most 500 transactions and an estimated 16 MiB of changed strings. If trimming old records makes the saved position unrecoverable, or one edit exceeds the byte budget, keep the current source text but leave the document marked as modified.

- Each record stores the source range that actually changed, the before and after strings, and the before and after selections.
- Consecutive character insertion, Backspace, and Delete operations merge when they continue at the same location within one second.
- An IME composition, including Korean text composition, is recorded as one ordinary input group from composition start to composition end.
- Paste, cut, menu deletion, newline insertion, line or selection duplication, automatic pairing, backtick code-block expansion and fence disabling, Markdown heading application and level replacement, indentation, and list-marker conversion are each independent actions with a clear semantic boundary.
- Caret movement, selection changes, focus changes, mode switching, and setting changes do not alter source text and therefore create no history record.
- Starting a new application-defined edit closes any active ordinary-input group.
- Starting a new edit after Undo discards the Redo history after the current position.
- Represent the saved state by the current history position, not by a separate Boolean. A document is dirty whenever its current position differs from its saved position.
- Route browser `historyUndo` and `historyRedo` input events to the application's Undo and Redo operations.

## Keep rendered output aligned with input positions

An editor that overlays a rendered backdrop and a real input element must manage both layers as one coordinate system.

- Keep font family, font size, line height, tab size, padding, wrapping width, and scroll position identical across both layers.
- Do not estimate horizontal indent-guide positions with character units such as CSS `ch`, which can differ from the width of actual spaces. Measure the actual width of each indentation block in the current render font so every guide remains on its corresponding leading whitespace even with a proportional font.
- Use the same word-breaking rules for soft wrapping, and never add display wraps to source text.
- While resize-driven wrapping calculations are unstable, prefer the real input text over an outdated rendered backdrop.
- Preserve syntax highlighting during selection, and draw the selection background from the rendered layer's actual glyph boundaries so its position cannot drift from the text. A selection that mixes proportional and monospace text follows the width of each rendered font. If a selection contains only newlines or blank lines and produces no rendered glyph range, keep the native `textarea` selection background; hide it only after at least one custom range is registered.
- Take custom-caret and click positions from the actual DOM ranges of the rendered text nodes after the browser completes layout, rather than recalculating them from character counts or average glyph widths. Use the range's horizontal position, vertical position, and height directly without snapping them back to an estimated line grid or replacing the height. For list bodies, exclude layout-only whitespace between the marker and body cells from coordinate mapping and use only the text ranges inside the body cell. Prefer the browser's native point-to-caret mapping and use a binary search over nearby DOM ranges only as a fallback. Never allocate or scan every character boundary in a long line. Skip empty rendered nodes at a line end and use the right edge of the last real glyph so the caret remains visible at the end of a source line and at the end of the document.
- Measure each visible source line after its final soft wrapping and use that height to position the next source line and its line number. Width estimates are only an initial virtualization fallback for offscreen lines and are replaced with measured heights when those lines enter the viewport.
- In render mode, do not derive the vertical scroll range from the native input's ordinary wrapping height or from separate allowances for individual render conditions. Use one scroll surface whose height is the sum of the final rendered line heights after code-block padding, heading sizing, list layout, and all other presentation rules, plus the editor's top and bottom padding, so the last rendered line remains reachable. Route ordinary vertical wheel input over the input layer to that final render scroll surface as well.
- When the user moves the viewport directly with a wheel, scrollbar drag, or touchpad, update only the caret geometry and visibility for the new scroll position; do not scroll back to reveal an offscreen caret. Reveal the caret only after an input that actually changes its position, such as keyboard navigation, a click, or an edit.
- Render inline code and fenced backtick code blocks with a monospace font by default while keeping the body text's font size and line height. Hide inline-code delimiters only when the backticks contain at least one non-whitespace character; show the backticks for an empty or whitespace-only inline-code span so its empty state remains visible. Hide the complete opening and closing fence lines of multi-line code blocks in render mode, while preserving their layout space for source-position mapping and preventing a collapsed caret from remaining inside hidden syntax. Use only about 12px of each hidden fence line for the block's top and bottom fill padding, inset the fill about 12px from both horizontal editor edges, and keep about 12px of inner padding between the fill edges and code text. Draw a multi-line code block as one continuous filled background from its opening fence through its closing fence without a separate outline, and keep code text and rendered selection highlights above the fill. Treat the default code text color as the lowest-priority fallback so syntax colors for brackets, list markers, strings, numbers, and similar tokens remain visible, and use a less saturated default code text color in the dark theme. Allow the code background and default code text colors to be changed independently for the light and dark themes. Even when proportional and monospace text share a line, calculate click mapping and caret placement from the actual rendered DOM ranges.
- Convert positions in both directions between Windows CRLF source text and the browser `textarea` selection offsets normalized to LF. Build line-start and CRLF-position indexes once per source revision and use binary search for conversions instead of rescanning from the document start on every input event.
- Use the same source-to-display position conversion for editing, Undo, Redo, and tab restoration.

## Input-handling priority

Several features can respond to the same key, so evaluate the most specific context first.

The current render-mode priority is:

The common `Ctrl+D` editing shortcut is handled first as an independent duplication command in both source and render modes. The priority below applies to render-mode editing-assistance input without Ctrl, Alt, or Meta.

Each editing-assistance command registers a unique identifier and a non-duplicated integer priority. `EditorCommandPipeline` sorts commands by that value regardless of their position in the registration array and stops after the first applicable command. A new command must state its intended position between existing commands through its priority; duplicate identifiers or priorities fail during application initialization.

1. Block deletion selections that include only part of a fenced-code delimiter
2. Disable fenced-block syntax on Backspace from the immediately following line
3. Block single-character deletion across a newline adjacent to a fenced-code delimiter
4. Move to the previous line end with ArrowLeft from the body start of a list continuation line
5. Create a marker-free list continuation line with Shift+Enter
6. Continue a checkbox item or end an empty checkbox item with Enter
7. End the list with Enter on an empty marker item
8. Continue a list marker and renumber following items on Enter
9. Create the next item and renumber following items from a list continuation line on Enter
10. Expand a structural JSON or JSONC delimiter pair with Enter
11. Preserve indentation on Enter for a general line
12. Remove the marker-tail character with Backspace at a list body start
13. Join a list continuation line with Backspace at its body start
14. Join an otherwise empty automatically indented line on Backspace
15. Indent or outdent lines with Tab or Shift+Tab
16. Delete leading indentation with Backspace
17. Delete an empty automatic pair with Backspace
18. Apply a Markdown heading or replace its existing level when confirmed by Space
19. Apply a context-aware substitution confirmed by Space
20. Insert an automatic pair, skip over a matching closing character, or expand the third backtick into a code block
21. Fall back to default `textarea` input when none of the conditions match

Do not chain one editing-assistance helper from inside another. The top-level input path selects exactly one feature by priority, and that feature records the final source text and selection only once.

## Procedure for designing a new editing feature

1. Define one user action and its expected result separately for source text, caret, and selection.
2. Define behavior for no selection, a single-line selection, and a multi-line selection.
3. Decide first whether the feature is render-mode-only or also belongs in source mode.
4. Define conditions that prevent interference with IME composition and operating-system shortcuts.
5. Verify that source position calculations have the same meaning in LF and CRLF documents.
6. Define the complete Undo and Redo boundary for the feature.
7. Fall back safely to default input or no operation when the result would not change.
8. Place the feature in the top-level input priority without conflicting with existing behavior.
9. Validate the result and caret using real key input.

## Validation checklist

When editing assistance is added or changed, verify at least the following:

- Does behavior remain natural when the caret is at the line start, inside a prefix, in the middle of the body, and at the line end?
- When a selection spans one or multiple lines, are both source text and the resulting selection correct?
- Is text after the caret preserved without deletion or reordering?
- Does the edit retain the same meaning in LF and CRLF source text?
- Does Korean or other IME composition remain intact without an automatic feature intervening?
- Is the default input behavior of source mode unchanged?
- Does one feature action revert with one Undo and restore the same resulting selection with Redo?
- Does a no-op avoid creating an unnecessary history record or dirty state?
- After soft wrapping, do the rendered layer, real input, caret, and selection still refer to the same position?
- Are intercepted key behaviors validated with real key events, such as browser automation `press()`, rather than only by assigning input values directly?

## text-pad implementation locations

- `src/routes/+page.svelte`: top-level render-mode input, caret and selection conversion, and edit-result recording.
- `src/lib/editor-command-pipeline.ts`: shared execution path that validates unique command identifiers and priorities and stops at the first applicable command.
- `src/lib/arrow-substitution.ts`: arrow-trigger recognition, source replacement, and final-caret calculation confirmed by Space.
- `src/lib/markdown-heading-edit.ts`: calculation of Markdown heading-marker application and existing-level replacement confirmed by Space.
- `src/lib/list-markers.ts`: list-marker recognition, sequence advancement, and depth-based style selection.
- `src/lib/line-oriented-formats.ts` and `src/lib/markdown-settings.ts`: Markdown heading recognition and shared per-level display settings.
- `src/lib/editor-undo.ts`: per-tab Undo and Redo history.
- `docs/features/render-mode.md`: rendered presentation and file-format-specific contracts.
- `docs/features/editor-undo.md`: internal Undo contract.

Whenever a natural render-mode editing feature is added, changed, or removed, update this document and `docs/features/natural-text-editing.md` in the same task so both language versions describe the current behavior.

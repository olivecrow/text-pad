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

## Editing Markdown headings

- In render-enabled `.md` and `.markdown` documents, recognize `# ` through `###### ` after no more than three leading spaces as heading levels 1 through 6.
- The default setting hides the leading heading marker, but keeps the same source range as hidden syntax so source text and selections remain stable. Do not hide or reinterpret the same markers inside a fenced code block.
- Per-level size and weight, marker visibility, and level 1 and 2 dividers are shared display settings for every Markdown document. Changing them alters neither source text nor Undo history.
- Typing `# ` remains ordinary character input. The app does not delete or rewrite the marker, and source mode displays it as normal HTML `textarea` text.
- Pointer placement, arrow movement, and selection on a heading map the actual rendered glyph widths back to source positions. Do not leave a collapsed caret trapped inside a hidden marker range.
- Links, emphasis, and inline code inside a heading keep their exact source ranges, and saved text never receives display-only size, weight, color, or divider data.

## Indentation and outdentation

Treat Tab as a command that makes the current line structurally deeper, not as a character that inserts spaces at the caret.

- With no selection, indent the entire line containing the caret.
- With a selection, indent every line touched by the selection in one operation.
- One indentation level is currently four spaces.
- An empty line is indented like any other line. Tab adds one indentation level and leaves the caret after it so the next text input starts at the indented position.
- Shift+Tab removes one leading tab or up to four leading spaces.
- Shift+Tab on a line with no leading whitespace changes neither source text nor Undo history.
- Move body-relative caret and selection positions by the prefix-length delta so they still point to the same place in the body.
- When Backspace is pressed inside leading indentation, remove whitespace back to the previous four-column boundary instead of deleting one space at a time. Remove one tab character at a time.
- Tab always applies to the entire line even when the caret is in the body and never inserts spaces in the middle of the body. Outside leading indentation, Backspace keeps its default deletion behavior.
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
- First-line body text, soft-wrapped display rows, and `Shift+Enter` continuation lines all use the same left edge of the body cell. Leading whitespace on a continuation line remains only as source-compatible structure and is not editable body whitespace in render mode.
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

## Context-aware substitutions

A string substitution should run only when the user enters a delimiter that confirms the intent to convert.

The current arrow substitutions apply after the user types a standalone trigger at the start of the document or after whitespace, then presses Space.

| Input | Result |
| --- | --- |
| `--> ` | `→ ` |
| `<-- ` | `← ` |
| `<-> ` | `↔ ` |
| `==> ` | `⇒ ` |
| `<== ` | `⇐ ` |
| `<=> ` | `⇔ ` |

- Do not convert a trigger in the middle of a word or attached to another character.
- Preserve one space after the substitution to represent the Space key the user pressed.
- Do not substitute when there is an active selection or an IME composition is in progress.
- Record the string replacement and trailing space together as one Undo action.

## Undo and Redo

An application with custom editing features should use one history system as the source of truth instead of mixing browser Undo history with application state.

`text-pad` uses a separate in-memory history for each tab.

- Each tab retains at most 500 transactions and an estimated 16 MiB of changed strings. If trimming old records makes the saved position unrecoverable, or one edit exceeds the byte budget, keep the current source text but leave the document marked as modified.

- Each record stores the source range that actually changed, the before and after strings, and the before and after selections.
- Consecutive character insertion, Backspace, and Delete operations merge when they continue at the same location within one second.
- An IME composition, including Korean text composition, is recorded as one ordinary input group from composition start to composition end.
- Paste, cut, menu deletion, newline insertion, automatic pairing, backtick code-block expansion and fence disabling, indentation, and list-marker conversion are each independent actions with a clear semantic boundary.
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
- Take custom-caret and click positions from the actual DOM ranges of the rendered text nodes after the browser completes layout, rather than recalculating them from character counts or average glyph widths. Prefer the browser's native point-to-caret mapping and use a binary search over nearby DOM ranges only as a fallback. Never allocate or scan every character boundary in a long line. Skip empty rendered nodes at a line end and use the right edge of the last real glyph so the caret remains visible at the end of a source line and at the end of the document.
- Measure each visible source line after its final soft wrapping and use that height to position the next source line and its line number. Width estimates are only an initial virtualization fallback for offscreen lines and are replaced with measured heights when those lines enter the viewport.
- Render inline code and fenced backtick code blocks with a monospace font by default while keeping the body text's font size and line height. Hide inline-code delimiters only when the backticks contain at least one non-whitespace character; show the backticks for an empty or whitespace-only inline-code span so its empty state remains visible. Hide the complete opening and closing fence lines of multi-line code blocks in render mode, while preserving their layout space for source-position mapping and preventing a collapsed caret from remaining inside hidden syntax. Use only about 12px of each hidden fence line for the block's top and bottom fill padding, inset the fill about 12px from both horizontal editor edges, and keep about 12px of inner padding between the fill edges and code text. Draw a multi-line code block as one continuous filled background from its opening fence through its closing fence without a separate outline, and keep code text and rendered selection highlights above the fill. Treat the default code text color as the lowest-priority fallback so syntax colors for brackets, list markers, strings, numbers, and similar tokens remain visible, and use a less saturated default code text color in the dark theme. Allow the code background and default code text colors to be changed independently for the light and dark themes. Even when proportional and monospace text share a line, calculate click mapping and caret placement from the actual rendered DOM ranges.
- Convert positions in both directions between Windows CRLF source text and the browser `textarea` selection offsets normalized to LF. Build line-start and CRLF-position indexes once per source revision and use binary search for conversions instead of rescanning from the document start on every input event.
- Use the same source-to-display position conversion for editing, Undo, Redo, and tab restoration.

## Input-handling priority

Several features can respond to the same key, so evaluate the most specific context first.

The current render-mode priority is:

1. Block deletion selections that include only part of a fenced-code delimiter
2. Disable fenced-block syntax on Backspace from the immediately following line
3. Block single-character deletion across a newline adjacent to a fenced-code delimiter
4. Create a marker-free list continuation line with Shift+Enter
5. End the list with Enter on an empty marker item
6. Continue a list marker and renumber following items on Enter
7. Create the next item and renumber following items from a list continuation line on Enter
8. Preserve indentation on Enter for a general line
9. Remove the marker-tail character with Backspace at a list body start
10. Join a list continuation line with Backspace at its body start
11. Join an otherwise empty automatically indented line on Backspace
12. Indent or outdent lines with Tab or Shift+Tab
13. Delete leading indentation with Backspace
14. Delete an empty automatic pair with Backspace
15. Apply a context-aware substitution confirmed by Space
16. Insert an automatic pair, skip over a matching closing character, or expand the third backtick into a code block
17. Fall back to default `textarea` input when none of the conditions match

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
- `src/lib/list-markers.ts`: list-marker recognition, sequence advancement, and depth-based style selection.
- `src/lib/line-oriented-formats.ts` and `src/lib/markdown-settings.ts`: Markdown heading recognition and shared per-level display settings.
- `src/lib/editor-undo.ts`: per-tab Undo and Redo history.
- `docs/features/render-mode.md`: rendered presentation and file-format-specific contracts.
- `docs/features/editor-undo.md`: internal Undo contract.

Whenever a natural render-mode editing feature is added, changed, or removed, update this document and `docs/features/natural-text-editing.md` in the same task so both language versions describe the current behavior.

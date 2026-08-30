interface EditorScrollHeightOptions {
  baseBottomPadding: number;
  clientHeight: number;
  renderedContentHeight: number;
  topPadding: number;
}

interface RenderWheelScrollOptions {
  deltaMode: number;
  deltaY: number;
  lineHeight: number;
  pageHeight: number;
  shiftKey: boolean;
}

/**
 * Defines the render-mode scroll surface from the final rendered line layout.
 */
export function getEditorScrollHeight(
  options: EditorScrollHeightOptions
): number {
  const baseBottomPadding = Math.max(0, options.baseBottomPadding);
  return Math.max(
    options.clientHeight,
    Math.ceil(options.topPadding + options.renderedContentHeight + baseBottomPadding)
  );
}

/**
 * Converts a regular vertical wheel event into the render viewport's pixel
 * scroll distance. Shift+wheel remains reserved for horizontal scrolling.
 */
export function getRenderWheelScrollDelta(
  options: RenderWheelScrollOptions
): number {
  if (options.shiftKey || options.deltaY === 0) return 0;

  if (options.deltaMode === 1) {
    return options.deltaY * Math.max(1, options.lineHeight);
  }
  if (options.deltaMode === 2) {
    return options.deltaY * Math.max(1, options.pageHeight);
  }
  return options.deltaY;
}

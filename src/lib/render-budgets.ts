/**
 * Rendering budgets protect the editor's single DOM surface from document sizes
 * that require virtualization or a dedicated editor implementation.
 */
export const MAX_ENHANCED_RENDER_CHARS = 2 * 1024 * 1024;
export const MAX_ENHANCED_RENDER_LINES = 100_000;

/**
 * Every interactive table cell owns a textarea and event handlers. Keep this
 * conservative until the table editor virtualizes rows and columns.
 */
export const MAX_INTERACTIVE_TABLE_CELLS = 2_000;

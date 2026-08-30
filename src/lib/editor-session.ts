import type { DocumentFormatId } from './document-formats';

export type TextEncoding = 'utf8' | 'utf8Bom' | 'utf16Le' | 'utf16Be';

export interface EditorTab {
  id: string;
  filePath: string | null;
  fileName: string;
  fileContent: string;
  selectedDocumentFormatId: DocumentFormatId | null;
  encoding: TextEncoding;
  isDirty: boolean;
  scrollTop: number;
  scrollLeft: number;
  selectionStart: number;
  selectionEnd: number;
  cursorLine: number;
  cursorCol: number;
  caretOffset: number;
}

export interface EditorSessionState {
  tabs: EditorTab[];
  activeTabId: string;
}

export type EditorTabUpdates = Partial<Omit<EditorTab, 'id'>>;

function assertValidTabs(tabs: readonly EditorTab[]) {
  if (tabs.length === 0) throw new Error('EditorSession requires at least one tab.');
  const tabIds = new Set(tabs.map((tab) => tab.id));
  if (tabIds.size !== tabs.length) throw new Error('EditorSession tab ids must be unique.');
}

export function createEditorSession(initialTab: EditorTab): EditorSessionState {
  return {
    tabs: [initialTab],
    activeTabId: initialTab.id
  };
}

export function getActiveEditorTabIndex(session: EditorSessionState): number {
  return session.tabs.findIndex((tab) => tab.id === session.activeTabId);
}

export function getActiveEditorTab(session: EditorSessionState): EditorTab | null {
  const activeIndex = getActiveEditorTabIndex(session);
  return activeIndex === -1 ? null : session.tabs[activeIndex];
}

export function activateEditorTab(
  session: EditorSessionState,
  tabId: string
): EditorSessionState {
  if (tabId === session.activeTabId) return session;
  return session.tabs.some((tab) => tab.id === tabId)
    ? { ...session, activeTabId: tabId }
    : session;
}

export function updateEditorTab(
  session: EditorSessionState,
  tabId: string,
  updates: EditorTabUpdates
): EditorSessionState {
  const tabIndex = session.tabs.findIndex((tab) => tab.id === tabId);
  if (tabIndex === -1) return session;

  const tabs = [...session.tabs];
  tabs[tabIndex] = { ...tabs[tabIndex], ...updates };
  return { ...session, tabs };
}

export function setEditorSessionTabs(
  session: EditorSessionState,
  tabs: EditorTab[],
  preferredActiveTabId = session.activeTabId
): EditorSessionState {
  assertValidTabs(tabs);
  const activeTabId = tabs.some((tab) => tab.id === preferredActiveTabId)
    ? preferredActiveTabId
    : tabs[0].id;
  return { tabs, activeTabId };
}

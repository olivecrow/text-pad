import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true }
});

try {
  const tabDrag = await server.ssrLoadModule('/src/lib/tab-drag.ts');
  const fileTabs = await server.ssrLoadModule('/src/lib/file-tabs.ts');
  const editorSession = await server.ssrLoadModule('/src/lib/editor-session.ts');
  const undo = await server.ssrLoadModule('/src/lib/editor-undo.ts');

  assert.equal(tabDrag.tabDetachTargetClaimDelayMs, 50);

  const dockBounds = { left: 40, top: 5, right: 760, bottom: 36 };
  assert.equal(tabDrag.isPointInsideTabDock(40, 5, dockBounds), true);
  assert.equal(tabDrag.isPointInsideTabDock(400, 20, dockBounds), true);
  assert.equal(tabDrag.isPointInsideTabDock(39, 20, dockBounds), false);
  assert.equal(tabDrag.isPointInsideTabDock(400, 37, dockBounds), false);

  assert.deepEqual(
    tabDrag.getTabDragPreviewPosition(240, 24, 48, 16, 800, 600),
    { left: 192, top: 8, visible: true }
  );
  assert.equal(
    tabDrag.getTabDragPreviewPosition(820, 24, 48, 16, 800, 600).visible,
    false
  );



  assert.equal(
    tabDrag.shouldReplaceDetachedWindowPlaceholder(null, 'incoming', true),
    false
  );
  assert.equal(
    tabDrag.shouldReplaceDetachedWindowPlaceholder('startup', 'incoming', true),
    false
  );
  assert.equal(
    tabDrag.shouldReplaceDetachedWindowPlaceholder('incoming', 'incoming', true),
    true
  );
  assert.equal(
    tabDrag.shouldReplaceDetachedWindowPlaceholder('incoming', 'incoming', false),
    false
  );

  const rects = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 }
  ];
  assert.equal(tabDrag.getTabDropIndex(20, rects), 0);
  assert.equal(tabDrag.getTabDropIndex(80, rects), 1);
  assert.equal(tabDrag.getTabDropIndex(260, rects), 3);
  assert.deepEqual(
    tabDrag.insertTabItem(['one', 'three'], 'two', 1),
    ['one', 'two', 'three']
  );

  assert.deepEqual(
    tabDrag.reorderTabItems(['one', 'two', 'three'], 0, 3),
    ['two', 'three', 'one']
  );
  assert.deepEqual(
    tabDrag.reorderTabItems(['one', 'two', 'three'], 2, 0),
    ['three', 'one', 'two']
  );

  const openTabs = [
    { id: 'untitled', filePath: null },
    { id: 'readme', filePath: 'C:\\Work\\text-pad\\README.md' }
  ];
  assert.equal(
    fileTabs.findOpenFileTab(openTabs, 'c:/work/text-pad/readme.md')?.id,
    'readme'
  );
  assert.equal(
    fileTabs.findOpenFileTab(openTabs, '\\\\?\\C:\\Work\\text-pad\\README.md')?.id,
    'readme'
  );
  assert.equal(
    fileTabs.findOpenFileTab(openTabs, 'C:\\Work\\text-pad\\other.md'),
    null
  );
  assert.equal(
    fileTabs.normalizeFilePathForComparison('\\\\?\\UNC\\Server\\Share\\File.txt'),
    '\\\\server\\share\\file.txt'
  );

  const sessionTab = (id, fileContent) => ({
    id,
    filePath: null,
    fileName: id,
    fileContent,
    selectedDocumentFormatId: 'markdown',
    encoding: 'utf8',
    isDirty: false,
    scrollTop: 0,
    scrollLeft: 0,
    selectionStart: 0,
    selectionEnd: 0,
    cursorLine: 1,
    cursorCol: 1,
    caretOffset: 0
  });
  const firstSessionTab = sessionTab('one', 'first');
  const secondSessionTab = sessionTab('two', 'second');
  const initialSession = editorSession.createEditorSession(firstSessionTab);
  const editedSession = editorSession.updateEditorTab(initialSession, 'one', {
    fileContent: 'first edit',
    isDirty: true,
    selectionStart: 10,
    selectionEnd: 10,
    caretOffset: 10
  });
  assert.equal(editorSession.getActiveEditorTab(editedSession).fileContent, 'first edit');
  assert.equal(initialSession.tabs[0].fileContent, 'first');

  const twoTabSession = editorSession.setEditorSessionTabs(
    editedSession,
    [...editedSession.tabs, secondSessionTab]
  );
  assert.equal(twoTabSession.activeTabId, 'one');
  const activatedSession = editorSession.activateEditorTab(twoTabSession, 'two');
  assert.equal(editorSession.getActiveEditorTab(activatedSession).id, 'two');
  const scrolledSession = editorSession.updateEditorTab(activatedSession, 'two', {
    scrollTop: 480,
    cursorLine: 24
  });
  assert.equal(editorSession.getActiveEditorTab(scrolledSession).scrollTop, 480);
  assert.equal(scrolledSession.tabs[0].scrollTop, 0);

  const closedActiveSession = editorSession.setEditorSessionTabs(
    scrolledSession,
    [scrolledSession.tabs[0]],
    'two'
  );
  assert.equal(closedActiveSession.activeTabId, 'one');
  assert.equal(editorSession.activateEditorTab(closedActiveSession, 'missing'), closedActiveSession);
  assert.throws(() => editorSession.setEditorSessionTabs(closedActiveSession, []));
  assert.throws(() => editorSession.setEditorSessionTabs(
    closedActiveSession,
    [firstSessionTab, { ...secondSessionTab, id: firstSessionTab.id }]
  ));

  const initialSnapshot = {
    content: 'one',
    selection: { start: 3, end: 3 }
  };
  const editedSnapshot = {
    content: 'one two',
    selection: { start: 7, end: 7 }
  };
  const history = new undo.EditorUndoHistory(initialSnapshot);
  assert.equal(history.record(initialSnapshot, editedSnapshot), true);
  const exportedState = history.exportState();
  const restoredHistory = undo.EditorUndoHistory.fromState(editedSnapshot, exportedState);
  assert.equal(restoredHistory.canUndo(), true);
  assert.equal(restoredHistory.isDirty(), true);
  assert.deepEqual(restoredHistory.undo(editedSnapshot), initialSnapshot);
  assert.equal(restoredHistory.canRedo(), true);

  const savedHistory = new undo.EditorUndoHistory(initialSnapshot);
  savedHistory.record(initialSnapshot, editedSnapshot);
  savedHistory.markSaved();
  const restoredSavedHistory = undo.EditorUndoHistory.fromState(
    editedSnapshot,
    savedHistory.exportState()
  );
  assert.equal(restoredSavedHistory.isDirty(), false);

  console.log(
    'Validated tabs: single-owner editor sessions, existing-file reuse, dock bounds, pointer-follow preview, blank-tab preservation, insertion indices, reordering, and undo-state transfer.'
  );
} finally {
  await server.close();
}

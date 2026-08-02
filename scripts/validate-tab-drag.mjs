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
    'Validated tab drag: dock bounds, pointer-follow preview, insertion indices, reordering, and undo-state transfer.'
  );
} finally {
  await server.close();
}

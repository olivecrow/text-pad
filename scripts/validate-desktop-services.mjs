import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true }
});

try {
  const desktopFileModule = await server.ssrLoadModule('/src/lib/desktop-file-service.ts');
  const desktopWindowModule = await server.ssrLoadModule('/src/lib/desktop-window-service.ts');
  const calls = [];
  const openedFile = { path: 'C:\\docs\\note.md', content: '# note', encoding: 'utf8' };
  const savedFile = { path: 'C:\\docs\\saved.md', encoding: 'utf8' };
  const responses = new Map([
    [desktopFileModule.desktopFileCommands.readDocumentImage, { mimeType: 'image/png', bytes: [137, 80, 78, 71] }],
    [desktopFileModule.desktopFileCommands.getStartupFiles, [openedFile]],
    [desktopFileModule.desktopFileCommands.openFileDialog, openedFile],
    [desktopFileModule.desktopFileCommands.openFilePaths, [openedFile]],
    [desktopFileModule.desktopFileCommands.saveFileDialog, savedFile],
    [desktopFileModule.desktopFileCommands.setupEditorWindowWheel, undefined],
    [desktopFileModule.desktopFileCommands.takePendingOpenFiles, [openedFile]],
    [desktopFileModule.desktopFileCommands.writeFileContent, undefined]
  ]);
  const files = desktopFileModule.createDesktopFileService(async (command, args) => {
    calls.push({ command, args });
    return responses.get(command);
  });
  const filters = [{ name: 'Text', extensions: ['txt', 'md'] }];
  const saveOptions = {
    defaultName: 'note.md',
    content: '# note',
    encoding: 'utf8',
    filters
  };
  const writeOptions = {
    path: openedFile.path,
    content: openedFile.content,
    encoding: openedFile.encoding
  };

  assert.deepEqual(await files.getStartupFiles(), [openedFile]);
  assert.deepEqual(await files.openFileDialog(filters), openedFile);
  assert.deepEqual(await files.openFilePaths([openedFile.path]), [openedFile]);
  assert.deepEqual(await files.saveFileDialog(saveOptions), savedFile);
  assert.equal(await files.setupEditorWindowWheel(), undefined);
  assert.deepEqual(await files.takePendingOpenFiles(), [openedFile]);
  assert.equal(await files.writeFileContent(writeOptions), undefined);
  assert.deepEqual(await files.readDocumentImage(openedFile.path, './image.png'), { mimeType: 'image/png', bytes: [137, 80, 78, 71] });

  assert.deepEqual(calls, [
    { command: 'get_startup_files', args: undefined },
    { command: 'open_file_dialog', args: { filters } },
    { command: 'open_file_paths', args: { paths: [openedFile.path] } },
    { command: 'save_file_dialog', args: saveOptions },
    { command: 'setup_editor_window_wheel', args: undefined },
    { command: 'take_pending_open_files', args: undefined },
    { command: 'write_file_content', args: writeOptions },
    { command: 'read_document_image', args: { documentPath: openedFile.path, relativePath: './image.png' } }
  ]);

  assert.equal(desktopWindowModule.desktopWindows.isAvailable(), false);
  assert.equal(desktopWindowModule.desktopWindows.currentLabel('test-browser'), 'test-browser');

  console.log(
    'Validated desktop file commands, request/response serialization, and browser-safe window fallback.'
  );
} finally {
  await server.close();
}

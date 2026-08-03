import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true }
});

try {
  const transfer = await server.ssrLoadModule('/src/lib/settings-transfer.ts');
  const documentFormats = await server.ssrLoadModule('/src/lib/document-formats.ts');
  const markdown = await server.ssrLoadModule('/src/lib/markdown-settings.ts');

  const lightColors = {
    codeBg: '#E2E8F0', codeText: '#0284C7', keyStrong: '#0369A1', keyMedium: '#0284C7',
    keyLight: '#38BDF8', string: '#B91C1C', number: '#D97706', listMarker: '#4F46E5',
    comment: '#475569', guide: '#CBD5E1', renderBg: '#F8FAFC', renderText: '#0F172A',
    renderFontWeight: '500', paren: '#A57800', bracket: '#B31C62', brace: '#097A70'
  };
  const darkColors = {
    ...lightColors,
    codeBg: '#1E293B',
    renderBg: '#0A0A0B',
    renderText: '#D6EAF0',
    renderFontWeight: '400'
  };
  const current = {
    general: { language: 'system', theme: 'dark' },
    source: { fontSize: 11 },
    render: {
      fontSize: 12,
      indentWidth: 4,
      fontFamily: 'nanum-gothic',
      editing: {
        autoPair: true,
        autoPairAllowedFollowingStrings: ['=', ':'],
        autoSymbols: true,
        preserveIndent: true
      },
      colors: { light: lightColors, dark: darkColors },
      formats: {
        features: documentFormats.createDefaultDocumentFeatureSettings(),
        markdown: markdown.createDefaultMarkdownRenderSettings(),
        table: {
          highlightHeader: true,
          showRowIndices: true,
          animateReorder: true,
          reorderDurationMs: 150
        }
      }
    }
  };

  const serialized = transfer.serializeSettingsFile(
    current,
    '0.4.0',
    new Date('2026-08-03T00:00:00.000Z')
  );
  const document = JSON.parse(serialized);
  assert.equal(document.format, 'text-pad-settings');
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.appVersion, '0.4.0');
  assert.equal(document.exportedAt, '2026-08-03T00:00:00.000Z');

  const roundTrip = transfer.parseSettingsFile(serialized, current);
  assert.equal(roundTrip.ok, true);
  assert.equal(roundTrip.sourceVersion, 1);
  assert.equal(roundTrip.skipped, 0);
  assert.deepEqual(roundTrip.settings, current);

  const legacy = transfer.parseSettingsFile(JSON.stringify({
    languagePreference: 'ko',
    sourceFontSize: 16,
    renderFontSize: 18,
    tabSize: 8,
    renderAutoPairEditing: false,
    renderAutoPairAllowedFollowingStrings: [';', '=>'],
    delimitedTableReorderDurationMs: 188
  }), current);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.sourceVersion, 0);
  assert.equal(legacy.settings.general.language, 'ko');
  assert.equal(legacy.settings.source.fontSize, 16);
  assert.equal(legacy.settings.render.fontSize, 18);
  assert.equal(legacy.settings.render.indentWidth, 8);
  assert.equal(legacy.settings.render.editing.autoPair, false);
  assert.deepEqual(legacy.settings.render.editing.autoPairAllowedFollowingStrings, [';', '=>']);
  assert.equal(legacy.settings.render.formats.table.reorderDurationMs, 200);
  assert.equal(legacy.settings.render.formats.table.showRowIndices, true);

  const future = transfer.parseSettingsFile(JSON.stringify({
    format: 'text-pad-settings',
    schemaVersion: 99,
    settings: {
      general: { language: 'ja', theme: 'ultraviolet', futurePreference: true },
      render: {
        fontSize: 500,
        fontFamily: 'future-font',
        editing: {
          autoPairAllowedFollowingStrings: ['valid', 1],
          autoSymbols: false,
          futureEditing: 'value'
        },
        colors: { light: { renderBg: '#aabbcc', codeText: 'not-a-color', futureColor: '#ffffff' } },
        formats: {
          features: {
            json: { render: false, edit: 'invalid', futureFlag: true },
            futureFormat: { render: true }
          },
          markdown: {
            headings: { 1: { sizePercent: 10, fontWeight: '800' }, 7: { sizePercent: 120 } }
          }
        }
      },
      futureSection: { enabled: true }
    }
  }), current);
  assert.equal(future.ok, true);
  assert.equal(future.newerVersion, true);
  assert.equal(future.settings.general.language, 'ja');
  assert.equal(future.settings.general.theme, 'dark');
  assert.equal(future.settings.render.fontSize, 72);
  assert.equal(future.settings.render.fontFamily, 'nanum-gothic');
  assert.equal(future.settings.render.editing.autoSymbols, false);
  assert.deepEqual(future.settings.render.editing.autoPairAllowedFollowingStrings, ['=', ':']);
  assert.equal(future.settings.render.colors.light.renderBg, '#AABBCC');
  assert.equal(future.settings.render.colors.light.codeText, '#0284C7');
  assert.equal(future.settings.render.formats.features.json.render, false);
  assert.equal(future.settings.render.formats.features.json.edit, true);
  assert.equal(future.settings.render.formats.markdown.headings[1].sizePercent, 80);
  assert.equal(future.settings.render.formats.markdown.headings[1].fontWeight, '800');
  assert.ok(future.skipped >= 8);

  assert.deepEqual(transfer.parseSettingsFile('{broken', current), { ok: false, reason: 'invalid_json' });
  assert.deepEqual(
    transfer.parseSettingsFile(JSON.stringify({ format: 'another-app', schemaVersion: 1, settings: {} }), current),
    { ok: false, reason: 'unsupported_format' }
  );
  assert.deepEqual(transfer.parseSettingsFile('[]', current), { ok: false, reason: 'invalid_structure' });
  assert.deepEqual(
    transfer.parseSettingsFile(JSON.stringify({ recipe: 'not settings' }), current),
    { ok: false, reason: 'invalid_structure' }
  );
  assert.deepEqual(
    transfer.parseSettingsFile(' '.repeat(transfer.maximumSettingsFileBytes + 1), current),
    { ok: false, reason: 'file_too_large' }
  );

  console.log('Validated settings transfer: versioned round-trip, legacy migration, future-field skipping, normalization, and malformed input handling.');
} finally {
  await server.close();
}

import assert from 'node:assert/strict';
import { createServer } from 'vite';

class MemorySettingsStorage {
  values;
  setCalls = [];
  removeCalls = [];
  failWrites = false;

  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error('write failed');
    this.setCalls.push([key, value]);
    this.values.set(key, value);
  }

  removeItem(key) {
    this.removeCalls.push(key);
    this.values.delete(key);
  }
}

const server = await createServer({
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true }
});

try {
  const transfer = await server.ssrLoadModule('/src/lib/settings-transfer.ts');
  const settingsRepositoryModule = await server.ssrLoadModule('/src/lib/settings-repository.ts');
  const themeColors = await server.ssrLoadModule('/src/lib/theme-colors.ts');
  const documentFormats = await server.ssrLoadModule('/src/lib/document-formats.ts');
  const markdown = await server.ssrLoadModule('/src/lib/markdown-settings.ts');

  const lightColors = {
    ...themeColors.getSystemDefaultColors(false),
    codeBg: '#E2E8F0', codeText: '#0284C7', keyStrong: '#0369A1', keyMedium: '#0284C7',
    keyLight: '#38BDF8', string: '#B91C1C', number: '#D97706', listMarker: '#4F46E5',
    comment: '#475569', guide: '#CBD5E1', renderBg: '#F8FAFC', renderText: '#0F172A',
    renderFontWeight: '500', paren: '#A57800', bracket: '#B31C62', brace: '#097A70'
  };
  const darkColors = {
    ...lightColors,
    ...Object.fromEntries(Object.entries(themeColors.getSystemDefaultColors(true)).map(([key, value]) => [key, value.toUpperCase()])),
    codeBg: '#1E293B',
    renderBg: '#0A0A0B',
    renderText: '#D6EAF0',
    renderFontWeight: '400'
  };
  assert.equal(themeColors.getSystemDefaultColors(false).renderBg, '#f8fafc');
  assert.equal(themeColors.getSystemDefaultColors(true).renderBg, '#0a0a0b');
  assert.equal(themeColors.normalizeHexColor(' #aabbcc '), '#AABBCC');
  assert.equal(themeColors.normalizeHexColor('#abc'), null);
  assert.equal(themeColors.getColorInputValue('invalid'), '#000000');
  assert.equal(themeColors.formatColorCode(' #aabbcc '), '#AABBCC');
  assert.equal(themeColors.getReadableTextColor('#FFFFFF'), '#000000');
  assert.equal(themeColors.getReadableTextColor('#000000'), '#ffffff');
  const current = {
    general: {
      language: 'system',
      theme: 'dark',
      defaultNewDocumentFormat: 'markdown'
    },
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

  const extraTheme = await server.ssrLoadModule('/src/lib/render-theme-fields.ts');
  const customized = structuredClone(current);
  for (const item of extraTheme.additionalRenderThemeFields) {
    customized.render.colors.light[item.field] = '#123456';
    customized.render.colors.dark[item.field] = '#ABCDEF';
  }
  const customizedRoundTrip = transfer.parseSettingsFile(transfer.serializeSettingsFile(customized, '0.5.1'), current);
  assert.equal(customizedRoundTrip.ok, true);
  assert.deepEqual(customizedRoundTrip.settings.render.colors, customized.render.colors);
  const oldPaletteFile = transfer.parseSettingsFile(JSON.stringify({format: 'text-pad-settings', schemaVersion: 1,
    settings: {render: {colors: {light: {comment: '#102030', selection: 'invalid'}}}}}), customized);
  assert.equal(oldPaletteFile.ok, true);
  assert.equal(oldPaletteFile.settings.render.colors.light.comment, '#102030');
  assert.equal(oldPaletteFile.settings.render.colors.light.selection, '#123456');
  assert.equal(oldPaletteFile.settings.render.colors.dark.caret, '#ABCDEF');
  for (const theme of ['light', 'dark']) {
    for (const field of ['searchHighlight', 'searchCurrentHighlight']) {
      assert.equal(oldPaletteFile.settings.render.colors[theme][field], customized.render.colors[theme][field]);
    }
  }

  const serialized = transfer.serializeSettingsFile(
    current,
    '0.5.1',
    new Date('2026-08-03T00:00:00.000Z')
  );
  const document = JSON.parse(serialized);
  assert.equal(document.format, 'text-pad-settings');
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.appVersion, '0.5.1');
  assert.equal(document.exportedAt, '2026-08-03T00:00:00.000Z');

  const roundTrip = transfer.parseSettingsFile(serialized, current);
  assert.equal(roundTrip.ok, true);
  assert.equal(roundTrip.sourceVersion, 1);
  assert.equal(roundTrip.skipped, 0);
  assert.deepEqual(roundTrip.settings, current);

  const legacy = transfer.parseSettingsFile(JSON.stringify({
    languagePreference: 'ko',
    defaultNewDocumentFormatId: 'tsv',
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
  assert.equal(legacy.settings.general.defaultNewDocumentFormat, 'tsv');
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
      general: {
        language: 'ja',
        theme: 'ultraviolet',
        defaultNewDocumentFormat: 'future-format',
        futurePreference: true
      },
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
  assert.equal(future.settings.general.defaultNewDocumentFormat, 'markdown');
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

  const legacyStorage = new MemorySettingsStorage({
    pref_language: 'ko',
    pref_default_new_document_format: 'tsv',
    pref_source_font_size: 'not-a-number',
    pref_render_font_size: '999',
    pref_tab_size: '3',
    pref_render_auto_pair_editing: 'false',
    pref_render_auto_pair_allowed_following_strings: JSON.stringify([';', '=>']),
    pref_delimited_table_reorder_duration_ms: '188',
    pref_document_format_features: JSON.stringify({ json: { render: false, edit: true } }),
    pref_light_codeBg: '#f1f5f9',
    pref_dark_codeText: '#38bdf8',
    pref_dark_renderBg: '#abcdef'
  });
  const legacyRepository = new settingsRepositoryModule.SettingsRepository(legacyStorage);
  const migrated = legacyRepository.load(current, { legacySystemIsDark: true });
  assert.equal(migrated.general.language, 'ko');
  assert.equal(migrated.general.defaultNewDocumentFormat, 'tsv');
  assert.equal(migrated.source.fontSize, current.source.fontSize);
  assert.equal(migrated.render.fontSize, 72);
  assert.equal(migrated.render.indentWidth, current.render.indentWidth);
  assert.equal(migrated.render.editing.autoPair, false);
  assert.deepEqual(migrated.render.editing.autoPairAllowedFollowingStrings, [';', '=>']);
  assert.equal(migrated.render.formats.table.reorderDurationMs, 200);
  assert.equal(migrated.render.formats.features.json.render, false);
  assert.equal(migrated.render.colors.light.codeBg, current.render.colors.light.codeBg);
  assert.equal(migrated.render.colors.dark.codeText, current.render.colors.dark.codeText);
  assert.equal(migrated.render.colors.dark.renderBg, '#ABCDEF');
  assert.equal(legacyStorage.setCalls.length, 1);
  assert.ok(legacyStorage.getItem(settingsRepositoryModule.settingsStorageKey));
  assert.equal(legacyStorage.getItem('pref_language'), null);
  assert.ok(legacyStorage.removeCalls.includes('pref_dark_renderBg'));

  const changed = structuredClone(migrated);
  changed.source.fontSize = -100;
  changed.render.indentWidth = 3;
  changed.render.colors.light.renderBg = '#aabbcc';
  changed.render.colors.light.searchHighlight = '#12abcd';
  changed.render.colors.dark.searchCurrentHighlight = '#de3456';
  assert.equal(legacyRepository.save(changed), true);
  const normalizedSaved = JSON.parse(legacyStorage.getItem(settingsRepositoryModule.settingsStorageKey));
  assert.equal(normalizedSaved.settings.source.fontSize, 6);
  assert.equal(normalizedSaved.settings.render.indentWidth, current.render.indentWidth);
  assert.equal(normalizedSaved.settings.render.colors.light.renderBg, '#AABBCC');
  assert.equal(normalizedSaved.settings.render.colors.light.searchHighlight, '#12ABCD');
  assert.equal(normalizedSaved.settings.render.colors.dark.searchCurrentHighlight, '#DE3456');
  const reloadedRepository = new settingsRepositoryModule.SettingsRepository(legacyStorage);
  const reloaded = reloadedRepository.load(current);
  assert.equal(reloaded.render.colors.light.searchHighlight, '#12ABCD');
  assert.equal(reloaded.render.colors.dark.searchCurrentHighlight, '#DE3456');
  const writeCountAfterChange = legacyStorage.setCalls.length;
  assert.equal(legacyRepository.save(changed), true);
  assert.equal(legacyStorage.setCalls.length, writeCountAfterChange);

  const remote = structuredClone(current);
  remote.general.theme = 'light';
  remote.source.fontSize = 24;
  const remoteValue = JSON.stringify({
    format: transfer.settingsFileFormat,
    schemaVersion: transfer.settingsSchemaVersion,
    settings: remote
  });
  assert.deepEqual(legacyRepository.parseStorageValue(remoteValue), remote);
  assert.equal(legacyRepository.parseStorageValue('{broken'), null);
  assert.equal(legacyRepository.parseStorageValue(null), null);

  const futureStoredValue = JSON.stringify({
    format: transfer.settingsFileFormat,
    schemaVersion: 99,
    settings: {
      general: { language: 'ja', futurePreference: true },
      futureSection: { enabled: true }
    }
  });
  const futureStorage = new MemorySettingsStorage({
    [settingsRepositoryModule.settingsStorageKey]: futureStoredValue
  });
  const futureRepository = new settingsRepositoryModule.SettingsRepository(futureStorage);
  assert.equal(futureRepository.load(current).general.language, 'ja');
  assert.equal(futureStorage.getItem(settingsRepositoryModule.settingsStorageKey), futureStoredValue);
  assert.equal(futureStorage.setCalls.length, 0);

  const failedMigrationStorage = new MemorySettingsStorage({ pref_language: 'ja' });
  failedMigrationStorage.failWrites = true;
  const failedMigrationRepository = new settingsRepositoryModule.SettingsRepository(failedMigrationStorage);
  assert.equal(failedMigrationRepository.load(current).general.language, 'ja');
  assert.equal(failedMigrationStorage.getItem('pref_language'), 'ja');
  assert.equal(failedMigrationStorage.removeCalls.length, 0);

  const corruptStorage = new MemorySettingsStorage({
    [settingsRepositoryModule.settingsStorageKey]: '{broken'
  });
  const corruptRepository = new settingsRepositoryModule.SettingsRepository(corruptStorage);
  assert.deepEqual(corruptRepository.load(current), current);
  assert.equal(corruptRepository.save(current), true);
  assert.doesNotThrow(() => JSON.parse(corruptStorage.getItem(settingsRepositoryModule.settingsStorageKey)));

  console.log('Validated settings transfer and repository: versioned round-trip, one-shot legacy migration, shared normalization, atomic persistence, cross-window parsing, and malformed input handling.');
} finally {
  await server.close();
}

import { describe, expect, it } from 'vitest';

import { SETTING_SEARCH_ENTRIES } from './settingsSearchEntries';
import { collectAnchorIds, readComponentSources } from './settingsSearchTestHelpers';

const sources = readComponentSources();
const filesById = new Map<string, string[]>();
for (const { path, source } of sources) {
  for (const id of new Set(collectAnchorIds(source))) {
    filesById.set(id, [...(filesById.get(id) ?? []), path]);
  }
}

describe('settings search anchors stay in sync with the registry', () => {
  it('every registry entry has its anchor in exactly one component file', () => {
    const problems = SETTING_SEARCH_ENTRIES.flatMap((entry) => {
      const files = filesById.get(entry.id) ?? [];
      return files.length === 1 ? [] : [`${entry.id}: found in ${files.length} files`];
    });
    expect(problems).toEqual([]);
  });

  it('every anchor in the components has a registry entry (no unreachable settings)', () => {
    const registered = new Set(SETTING_SEARCH_ENTRIES.map((entry) => entry.id));
    const orphans = [...filesById.keys()].filter((id) => !registered.has(id));
    expect(orphans).toEqual([]);
  });

  it('no anchor id repeats within a single file', () => {
    const duplicates = sources.flatMap(({ path, source }) => {
      const ids = collectAnchorIds(source);
      return ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `${path}: ${id}`);
    });
    expect(duplicates).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import en from '../i18n/en';
import zh from '../i18n/zh';

const I18N_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'i18n');

// A duplicate key is invisible to every test that inspects the imported
// object: by then JavaScript has already resolved it, the last definition
// having silently overwritten the earlier one. Nothing warns, and the key-set
// comparison below still passes when BOTH files carry the same duplicates.
// So this check reads the SOURCE TEXT instead.
//
// It relies on the house style of these two files: one `key: value,` per line,
// and a nested object opened by a line ending in `{`.
function findDuplicateKeys(source) {
  const duplicates = [];
  const scopes = [{ path: '', seen: new Map() }];

  source.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) return;

    const match = line.match(/^([A-Za-z_$][\w$]*)\s*:/);
    if (match) {
      const key = match[1];
      const scope = scopes[scopes.length - 1];
      const path = scope.path ? `${scope.path}.${key}` : key;
      const previous = scope.seen.get(key);
      if (previous) duplicates.push(`${path} (lines ${previous} and ${lineNumber})`);
      else scope.seen.set(key, lineNumber);
      if (line.endsWith('{')) scopes.push({ path, seen: new Map() });
      return;
    }
    if (line.startsWith('}') && scopes.length > 1) scopes.pop();
  });

  return duplicates;
}

// Collect every key path (e.g. "common.status.PENDING") from a dictionary.
// Non-plain-object values (strings, arrays) are leaves — we only recurse
// into plain objects so a future array value won't break the test.
function collectKeyPaths(obj, prefix = '') {
  const paths = [];
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectKeyPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

describe('i18n dictionaries', () => {
  it('English dictionary has required top-level keys', () => {
    expect(en).toHaveProperty('common');
    expect(en).toHaveProperty('login');
  });

  it('Chinese dictionary has the same top-level keys as English', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('common.loading exists in both languages', () => {
    expect(en.common.loading).toBeDefined();
    expect(zh.common.loading).toBeDefined();
  });

  // Phase 12 of the tournament→competition migration renamed keys in both
  // dictionaries. A missing key in one file would silently fall back to the
  // key string at runtime, which is hard to notice by eye. This test fails
  // on the FIRST divergent path so we catch any rename miss immediately.
  it('English and Chinese dictionaries have exactly the same keys at every nesting level', () => {
    const enPaths = collectKeyPaths(en).sort();
    const zhPaths = collectKeyPaths(zh).sort();
    expect(zhPaths).toEqual(enPaths);
  });

  // Regression guard for the residue left by the removed "Rounds" section of
  // CompetitionDetailPage: `competitionDetail.addRound` and `addRoundSubmit`
  // were each defined twice, so the stage-configuration panel silently showed
  // the old wording. The key-set test above could not see it.
  it.each([['en'], ['zh']])('%s dictionary defines every key exactly once', (lang) => {
    const source = readFileSync(join(I18N_DIR, `${lang}.js`), 'utf8');
    expect(findDuplicateKeys(source)).toEqual([]);
  });
});

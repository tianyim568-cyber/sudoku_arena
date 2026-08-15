import { describe, it, expect } from 'vitest';
import en from '../i18n/en';
import zh from '../i18n/zh';

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
});

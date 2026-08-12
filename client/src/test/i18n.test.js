import { describe, it, expect } from 'vitest';
import en from '../i18n/en';
import zh from '../i18n/zh';

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
});

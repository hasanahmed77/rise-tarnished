// #56 — persisted client settings. vitest's default environment here is
// Node (no DOM), which is exactly the case this module has to survive
// (`next build`'s prerender pass) — a minimal localStorage polyfill is
// installed per-test to exercise the real read/write path on top of that.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GameSettings } from './settings';

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fakeLocalStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
  // @ts-expect-error -- test-only global patch, not the real DOM lib
  globalThis.window = { localStorage: fakeLocalStorage };
  return fakeLocalStorage;
}

function removeWindow() {
  // @ts-expect-error -- restoring the no-DOM baseline this module must
  // tolerate (see the file header)
  delete globalThis.window;
}

describe('settings (no window — the SSR/build-time case)', () => {
  beforeEach(removeWindow);

  it('loadSettings returns the defaults rather than throwing', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings no-ops rather than throwing', () => {
    expect(() => saveSettings({ screenshakeEnabled: false, muted: true })).not.toThrow();
  });
});

describe('settings (with a real localStorage)', () => {
  afterEach(removeWindow);

  it('round-trips exactly what was saved', () => {
    installFakeLocalStorage();
    const settings: GameSettings = { screenshakeEnabled: false, muted: true };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  it('returns the defaults when nothing has ever been saved', () => {
    installFakeLocalStorage();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults on unparsable JSON rather than crashing', () => {
    const storage = installFakeLocalStorage();
    storage.setItem('rise-tarnished:settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in a missing field with its default rather than losing the other', () => {
    // Simulates a value written by an OLDER version of this module before a
    // field existed — forward-compatible, not a full reset.
    const storage = installFakeLocalStorage();
    storage.setItem('rise-tarnished:settings', JSON.stringify({ muted: true }));
    expect(loadSettings()).toEqual({
      screenshakeEnabled: DEFAULT_SETTINGS.screenshakeEnabled,
      muted: true,
    });
  });

  it('ignores a field of the wrong type rather than trusting it', () => {
    const storage = installFakeLocalStorage();
    storage.setItem(
      'rise-tarnished:settings',
      JSON.stringify({ screenshakeEnabled: 'yes', muted: 1 }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('a write failure (e.g. quota) degrades silently rather than throwing', () => {
    installFakeLocalStorage();
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => saveSettings({ screenshakeEnabled: true, muted: false })).not.toThrow();
    window.localStorage.setItem = original;
  });
});

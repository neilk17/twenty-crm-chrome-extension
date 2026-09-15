import { describe, expect, it } from 'vitest';
import { resolveSettingsUpdate } from '../settings-update';

const stored = { twentyUrl: 'https://a.example.com', apiKey: 'key-for-a' };

describe('resolveSettingsUpdate', () => {
  it('clears the stored key when the Twenty URL changes', () => {
    // Regression: an API key authorizes one instance. Carrying it across a URL
    // change would send instance A's key to instance B on the next request,
    // before the user has any chance to re-authorize.
    const result = resolveSettingsUpdate(stored, { twentyUrl: 'https://b.example.com' });

    expect(result).toEqual({
      ok: true,
      changes: { twentyUrl: 'https://b.example.com', apiKey: '' },
    });
  });

  it('keeps the key when the same URL is saved again', () => {
    const result = resolveSettingsUpdate(stored, { twentyUrl: 'https://a.example.com' });

    expect(result).toEqual({ ok: true, changes: { twentyUrl: 'https://a.example.com' } });
  });

  it('treats a differently spelled but equivalent URL as unchanged', () => {
    const result = resolveSettingsUpdate(stored, { twentyUrl: 'a.example.com/' });

    expect(result).toEqual({ ok: true, changes: { twentyUrl: 'https://a.example.com' } });
  });

  it('has nothing to clear when no key is stored', () => {
    const result = resolveSettingsUpdate(
      { twentyUrl: 'https://a.example.com', apiKey: '' },
      { twentyUrl: 'https://b.example.com' },
    );

    expect(result).toEqual({ ok: true, changes: { twentyUrl: 'https://b.example.com' } });
  });

  it('accepts a new key on its own and strips a pasted Bearer prefix', () => {
    const result = resolveSettingsUpdate(stored, { apiKey: '  Bearer new.key.here ' });

    expect(result).toEqual({ ok: true, changes: { apiKey: 'new.key.here' } });
  });

  it('lets a key saved alongside a URL change win over the clear', () => {
    const result = resolveSettingsUpdate(stored, {
      twentyUrl: 'https://b.example.com',
      apiKey: 'key-for-b',
    });

    expect(result).toEqual({
      ok: true,
      changes: { twentyUrl: 'https://b.example.com', apiKey: 'key-for-b' },
    });
  });

  it('rejects an invalid URL without touching the key', () => {
    const result = resolveSettingsUpdate(stored, { twentyUrl: 'http://' });

    expect(result).toEqual({ ok: false, error: expect.stringContaining('valid Twenty URL') });
  });

  it('rejects a key containing whitespace', () => {
    const result = resolveSettingsUpdate(stored, { apiKey: 'abc def' });

    expect(result).toEqual({ ok: false, error: expect.stringContaining('APIs & Webhooks') });
  });
});

import { normalizeApiKey } from './twenty-api';
import { normalizeTwentyUrl } from './twenty-url';
import type { ExtensionSettings } from '../types';

export type SettingsUpdateResult =
  | { ok: true; changes: Partial<ExtensionSettings> }
  | { ok: false; error: string };

/**
 * Decides what SAVE_SETTINGS should write, given what is already stored.
 *
 * An API key authorizes exactly one Twenty instance, so pointing the extension
 * at a different host clears the stored key: otherwise the next request would
 * send the previous instance's key to the new host before the user has any
 * chance to re-authorize it.
 */
export function resolveSettingsUpdate(
  current: ExtensionSettings,
  payload: { twentyUrl?: string; apiKey?: string },
): SettingsUpdateResult {
  const changes: Partial<ExtensionSettings> = {};

  if (payload.twentyUrl !== undefined) {
    const validatedTwentyUrl = normalizeTwentyUrl(payload.twentyUrl);
    if (!validatedTwentyUrl) {
      return {
        ok: false,
        error:
          'Enter a valid Twenty URL, for example https://app.twenty.com or https://crm.example.com.',
      };
    }

    changes.twentyUrl = validatedTwentyUrl;

    if (current.twentyUrl !== validatedTwentyUrl && current.apiKey) {
      changes.apiKey = '';
    }
  }

  if (payload.apiKey !== undefined) {
    const validatedApiKey = normalizeApiKey(payload.apiKey);
    if (!validatedApiKey) {
      return {
        ok: false,
        error: 'Paste the API key exactly as Twenty shows it under Settings → APIs & Webhooks.',
      };
    }

    changes.apiKey = validatedApiKey;
  }

  return { ok: true, changes };
}

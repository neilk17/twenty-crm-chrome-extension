import { getOrCreateAnalyticsId } from './storage';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

function isEnabled(): boolean {
  return !!POSTHOG_KEY && POSTHOG_KEY !== 'undefined';
}

export type AnalyticsEvent =
  | 'capture_created'
  | 'capture_updated'
  | 'capture_initiated'
  | 'duplicate_detected'
  | 'settings_saved'
  | 'connection_tested'
  | 'extension_opened'
  | 'error_occurred';

type EventProperties = Record<string, string | number | boolean | null | undefined>;

export async function track(event: AnalyticsEvent, properties: EventProperties = {}): Promise<void> {
  if (!isEnabled()) return;
  let distinctId: string;
  try {
    distinctId = await getOrCreateAnalyticsId();
  } catch {
    return;
  }
  const payload = {
    api_key: POSTHOG_KEY,
    batch: [{
      distinct_id: distinctId,
      event,
      properties: {
        ...properties,
        $lib: 'twenty-crm-extension',
      },
      timestamp: new Date().toISOString(),
    }],
  };
  try {
    fetch(`${POSTHOG_HOST}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true, // critical: survives service worker termination
    }).catch(() => {});
  } catch {
    // never break the app
  }
}

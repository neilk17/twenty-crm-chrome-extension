import {
  TwentyApiClient,
  isTwentyAuthErrorMessage,
  NO_API_KEY_MESSAGE,
} from '../lib/twenty-api';
import { getSettings, saveSettings, addToRecentCaptures, getRecentCaptures } from '../lib/storage';
import { getNormalizedDomain } from '../lib/domain-extractor';
import { normalizeTwentyUrl, resolveTwentyApiBaseUrl } from '../lib/twenty-url';
import { resolveSettingsUpdate } from '../lib/settings-update';
import type { ExtensionMessage, ExtensionResponse, LinkedInProfileData, LinkedInCompanyData, DomainCompanyData } from '../types';

// Cache for API client
let apiClient: TwentyApiClient | null = null;
let cachedTwentyUrl: string | null = null;

function isAuthError(error: unknown): boolean {
  return error instanceof Error && isTwentyAuthErrorMessage(error.message);
}

function apiKeyPreview(apiKey: string): string {
  return apiKey.length > 6 ? `…${apiKey.slice(-6)}` : '';
}

// Get or create API client
async function getApiClient(): Promise<TwentyApiClient> {
  const settings = await getSettings();

  if (!settings.twentyUrl) {
    throw new Error('Twenty URL not configured');
  }

  const apiBaseUrl = resolveTwentyApiBaseUrl(settings.twentyUrl);
  if (!apiBaseUrl) {
    throw new Error('Invalid Twenty URL. Enter your full Twenty workspace URL.');
  }

  // Create new client if URL changed
  if (cachedTwentyUrl !== apiBaseUrl || !apiClient) {
    apiClient = new TwentyApiClient(apiBaseUrl);
    cachedTwentyUrl = apiBaseUrl;
  }

  if (!settings.apiKey) {
    throw new Error(NO_API_KEY_MESSAGE);
  }

  apiClient.setToken(settings.apiKey);
  return apiClient;
}

// Check if a person already exists (by LinkedIn URL or name)
async function checkPersonDuplicate(
  client: TwentyApiClient,
  linkedinUrl: string,
  firstName?: string,
  lastName?: string
): Promise<{ exists: boolean; record?: { id: string; type: string }; matchedBy?: string }> {
  // First, try to find by LinkedIn URL
  try {
    const personByLinkedIn = await client.findPersonByLinkedInUrl(linkedinUrl);
    if (personByLinkedIn) {
      console.log('Found person by LinkedIn URL:', personByLinkedIn.id);
      return { exists: true, record: { id: personByLinkedIn.id, type: 'person' }, matchedBy: 'linkedin' };
    }
  } catch (error) {
    if (isAuthError(error)) {
      throw error;
    }
    console.warn('Lookup by LinkedIn URL failed:', error);
  }

  // If not found by LinkedIn URL and we have name, try by name
  if (firstName && lastName) {
    try {
      const personByName = await client.findPersonByName(firstName, lastName);
      if (personByName) {
        console.log('Found person by name:', personByName.id, personByName.name);
        return { exists: true, record: { id: personByName.id, type: 'person' }, matchedBy: 'name' };
      }
    } catch (error) {
      if (isAuthError(error)) {
        throw error;
      }
      console.warn('Lookup by person name failed:', error);
    }
  }

  return { exists: false };
}

// Check if a company already exists (by LinkedIn URL, domain, or name)
async function checkCompanyDuplicate(
  client: TwentyApiClient,
  linkedinUrl?: string,
  companyName?: string,
  domain?: string
): Promise<{ exists: boolean; record?: { id: string; type: string }; matchedBy?: string }> {
  // First, try to find by LinkedIn URL if provided
  if (linkedinUrl) {
    try {
      const companyByLinkedIn = await client.findCompanyByLinkedInUrl(linkedinUrl);
      if (companyByLinkedIn) {
        console.log('Found company by LinkedIn URL:', companyByLinkedIn.id);
        return { exists: true, record: { id: companyByLinkedIn.id, type: 'company' }, matchedBy: 'linkedin' };
      }
    } catch (error) {
      if (isAuthError(error)) {
        throw error;
      }
      console.warn('Lookup by company LinkedIn URL failed:', error);
    }
  }

  // Try to find by domain if provided
  if (domain) {
    try {
      const companyByDomain = await client.findCompanyByDomain(domain);
      if (companyByDomain) {
        console.log('Found company by domain:', companyByDomain.id, companyByDomain.name);
        return { exists: true, record: { id: companyByDomain.id, type: 'company' }, matchedBy: 'domain' };
      }
    } catch (error) {
      if (isAuthError(error)) {
        throw error;
      }
      console.warn('Lookup by company domain failed:', error);
    }
  }

  // If not found by LinkedIn URL or domain and we have name, try by name
  if (companyName) {
    try {
      const companyByName = await client.findCompanyByName(companyName);
      if (companyByName) {
        console.log('Found company by name:', companyByName.id, companyByName.name);
        return { exists: true, record: { id: companyByName.id, type: 'company' }, matchedBy: 'name' };
      }
    } catch (error) {
      if (isAuthError(error)) {
        throw error;
      }
      console.warn('Lookup by company name failed:', error);
    }
  }

  return { exists: false };
}

// Check if a company exists by domain only
async function checkCompanyDuplicateByDomain(
  domain: string
): Promise<{ exists: boolean; record?: { id: string; type: string }; matchedBy?: string }> {
  const client = await getApiClient();
  return checkCompanyDuplicate(client, undefined, undefined, domain);
}

// Check if a record already exists (broader matching)
async function checkDuplicate(
  linkedinUrl: string,
  pageType: 'person' | 'company',
  scrapedData?: LinkedInProfileData | LinkedInCompanyData
): Promise<{ exists: boolean; record?: { id: string; type: string }; matchedBy?: string }> {
  const client = await getApiClient();

  if (pageType === 'person') {
    const personData = scrapedData as LinkedInProfileData | undefined;
    return checkPersonDuplicate(
      client,
      linkedinUrl,
      personData?.firstName,
      personData?.lastName
    );
  } else {
    const companyData = scrapedData as LinkedInCompanyData | undefined;
    return checkCompanyDuplicate(
      client,
      linkedinUrl,
      companyData?.name
    );
  }
}

// Create a new record
async function createRecord(
  data: LinkedInProfileData | LinkedInCompanyData
): Promise<{ id: string }> {
  const client = await getApiClient();

  if (data.type === 'person') {
    const person = await client.createPerson(data);

    // Save to recent captures
    await addToRecentCaptures({
      linkedinUrl: data.linkedinUrl,
      name: `${data.firstName} ${data.lastName}`,
      type: 'person',
      twentyId: person.id,
    });

    return { id: person.id };
  } else {
    const company = await client.createCompany(data);

    // Save to recent captures
    await addToRecentCaptures({
      linkedinUrl: data.linkedinUrl,
      name: data.name,
      type: 'company',
      twentyId: company.id,
    });

    return { id: company.id };
  }
}

// Create a company by domain
async function createCompanyByDomain(
  domain: string,
  companyName?: string
): Promise<{ id: string }> {
  const client = await getApiClient();

  // Convert to LinkedInCompanyData format for API (without LinkedIn URL)
  const apiData: LinkedInCompanyData = {
    type: 'company',
    linkedinUrl: '', // Empty LinkedIn URL for domain-only companies
    name: companyName || '', // Leave name blank if not provided
    website: `https://${domain}`, // Use domain as website URL
  };

  const company = await client.createCompany(apiData);

  // Save to recent captures (using domain as identifier since there's no LinkedIn URL)
  await addToRecentCaptures({
    linkedinUrl: `domain:${domain}`, // Use domain as identifier
    name: company.name || domain, // Fall back to domain for display since name may be blank
    type: 'company',
    twentyId: company.id,
  });

  return { id: company.id };
}

// Test connection to Twenty
async function testConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const client = await getApiClient();
    const connected = await client.testConnection();
    if (!connected) {
      return { connected: false, error: 'Connected to Twenty, but the API key could not read this workspace. Check the key under Settings → APIs & Webhooks.' };
    }
    return { connected: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    if (isTwentyAuthErrorMessage(errorMessage) || errorMessage.includes('No API key')) {
      console.info('Test connection needs a valid Twenty API key.');
    } else {
      console.error('Test connection failed:', err);
    }

    // Provide more specific error messages
    if (errorMessage.includes('not configured')) {
      return { connected: false, error: 'Twenty URL is not configured. Please enter your Twenty URL.' };
    }
    if (errorMessage.includes('Invalid Twenty URL')) {
      return {
        connected: false,
        error: 'Enter a valid Twenty URL, for example https://app.twenty.com or https://crm.example.com.',
      };
    }
    if (errorMessage.includes('No API key')) {
      return { connected: false, error: NO_API_KEY_MESSAGE };
    }
    if (isTwentyAuthErrorMessage(errorMessage)) {
      return {
        connected: false,
        error: 'Twenty rejected the API key. Create a new key under Settings → APIs & Webhooks and paste it again.',
      };
    }
    if (errorMessage.includes('HTTP error')) {
      return { connected: false, error: 'Could not reach your Twenty instance. Please check the URL and ensure it is accessible.' };
    }

    return { connected: false, error: `Connection failed: ${errorMessage}` };
  }
}

// Handle messages
async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  console.log('Received message:', message.type);

  try {
    switch (message.type) {
      case 'CHECK_DUPLICATE': {
        const { linkedinUrl, pageType, scrapedData } = message.payload as {
          linkedinUrl: string;
          pageType: 'person' | 'company';
          scrapedData?: LinkedInProfileData | LinkedInCompanyData;
        };
        const result = await checkDuplicate(linkedinUrl, pageType, scrapedData);
        return { success: true, data: result };
      }

      case 'CREATE_RECORD': {
        const data = message.payload as LinkedInProfileData | LinkedInCompanyData;
        try {
          const result = await createRecord(data);
          return { success: true, data: result };
        } catch (err) {
          throw err;
        }
      }

      case 'GET_SETTINGS': {
        const settings = await getSettings();
        const normalizedTwentyUrl = settings.twentyUrl
          ? normalizeTwentyUrl(settings.twentyUrl)
          : null;
        const invalidTwentyUrl = settings.twentyUrl && !normalizedTwentyUrl
          ? settings.twentyUrl
          : '';
        // The key itself never leaves the background script; the panel only needs a hint.
        return {
          success: true,
          data: {
            twentyUrl: normalizedTwentyUrl || '',
            invalidTwentyUrl,
            hasApiKey: !!settings.apiKey,
            apiKeyPreview: apiKeyPreview(settings.apiKey),
          }
        };
      }

      case 'SAVE_SETTINGS': {
        const newSettings = message.payload as { twentyUrl?: string; apiKey?: string };
        const currentSettings = await getSettings();
        const update = resolveSettingsUpdate(currentSettings, newSettings);

        if (!update.ok) {
          return { success: false, error: update.error };
        }

        if (update.changes.apiKey === '' && currentSettings.apiKey) {
          console.info('Twenty URL changed; clearing the stored API key.');
        }

        console.log('Saving settings:', {
          ...update.changes,
          apiKey: update.changes.apiKey ? '[redacted]' : update.changes.apiKey,
        });
        await saveSettings(update.changes);
        // Clear cached client so the next request picks up the new URL or key
        apiClient = null;
        cachedTwentyUrl = null;
        console.log('Settings saved successfully');
        return { success: true };
      }

      case 'TEST_CONNECTION': {
        const result = await testConnection();
        if (result.connected) {
          return { success: true, data: { connected: true } };
        } else {
          return { success: false, error: result.error || 'Connection test failed' };
        }
      }

      case 'GET_RECENT_CAPTURES': {
        const captures = await getRecentCaptures();
        return { success: true, data: captures };
      }

      case 'SEARCH_RECORDS': {
        const { query, type } = message.payload as { query: string; type: 'person' | 'company' };
        const client = await getApiClient();
        const results = await client.searchRecords(query, type);
        return { success: true, data: results };
      }

      case 'UPDATE_RECORD': {
        const { id, type, data } = message.payload as {
          id: string;
          type: 'person' | 'company';
          data: LinkedInProfileData | LinkedInCompanyData;
        };
        const client = await getApiClient();
        try {
          await client.updateRecordWithLinkedInData(id, type, data);
          return { success: true, data: { id } };
        } catch (err) {
          throw err;
        }
      }

      case 'SCRAPE_PAGE': {
        const { tabId } = message.payload as { tabId: number };
        try {
          // Execute script to scrape the page
          const results = await browser.scripting.executeScript({
            target: { tabId },
            func: () => {
              const linkedinUrl = window.location.href.split('?')[0];
              const isPerson = linkedinUrl.includes('linkedin.com/in/');
              const isCompany = linkedinUrl.includes('linkedin.com/company/');

              if (!isPerson && !isCompany) {
                return { type: null, data: null };
              }

              // For now, return the URL and type - we'll scrape in the content script
              return {
                type: isPerson ? 'person' : 'company',
                url: linkedinUrl,
              };
            },
          });

          if (results && results[0]?.result) {
            return { success: true, data: results[0].result };
          }
          return { success: false, error: 'Could not scrape page' };
        } catch (error) {
          console.error('Error scraping page:', error);
          return { success: false, error: 'Could not access page' };
        }
      }

      case 'CHECK_DUPLICATE_BY_DOMAIN': {
        const { domain } = message.payload as { domain: string };
        const result = await checkCompanyDuplicateByDomain(domain);
        return { success: true, data: result };
      }

      case 'CREATE_COMPANY_BY_DOMAIN': {
        const { domain, companyName } = message.payload as { domain: string; companyName?: string };
        const result = await createCompanyByDomain(domain, companyName);
        return { success: true, data: result };
      }

      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isExpectedSetupState = errorMessage.includes('Twenty URL not configured')
      || errorMessage.includes('No API key')
      || isTwentyAuthErrorMessage(errorMessage);

    if (!isExpectedSetupState) {
      console.error('Background error:', error);
    }
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Message handler
export default defineBackground(() => {
  // Use the proper WXT/webextension-polyfill pattern for async message handling
  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      // Handle async by returning true and using sendResponse
      handleMessage(message).then(sendResponse);
      return true; // Indicates we will send a response asynchronously
    }
  );

  // Make clicking the extension icon open the side panel directly
  try {
    if (browser.sidePanel) {
      (browser.sidePanel as any).setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (error) {
    console.warn('Could not set side panel behavior:', error);
  }
  console.log('Twenty CRM Extension background loaded');
});

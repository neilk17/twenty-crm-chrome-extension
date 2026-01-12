import { TwentyApiClient, extractTokenFromCookie } from '../lib/twenty-api';
import { getSettings, saveSettings, addToRecentCaptures, getRecentCaptures } from '../lib/storage';
import type { ExtensionMessage, ExtensionResponse, LinkedInProfileData, LinkedInCompanyData } from '../types';

// Cache for API client
let apiClient: TwentyApiClient | null = null;
let cachedTwentyUrl: string | null = null;

// Get or create API client
async function getApiClient(): Promise<TwentyApiClient> {
  const settings = await getSettings();

  if (!settings.twentyUrl) {
    throw new Error('Twenty URL not configured');
  }

  // Create new client if URL changed
  if (cachedTwentyUrl !== settings.twentyUrl || !apiClient) {
    apiClient = new TwentyApiClient(settings.twentyUrl);
    cachedTwentyUrl = settings.twentyUrl;
  }

  // Get fresh token from cookie
  const token = await getAuthToken(settings.twentyUrl);
  if (!token) {
    throw new Error('No authentication token found. Please log in to Twenty CRM.');
  }

  apiClient.setToken(token);
  return apiClient;
}

// Extract domain from URL for cookie access
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

// Get auth token from Twenty's cookie
async function getAuthToken(twentyUrl: string): Promise<string | null> {
  try {
    // Try to get the tokenPair cookie from Twenty domain
    const cookie = await browser.cookies.get({
      url: twentyUrl,
      name: 'tokenPair',
    });

    console.log('Cookie lookup for', twentyUrl, ':', cookie ? 'found' : 'not found');

    if (cookie?.value) {
      const decodedValue = decodeURIComponent(cookie.value);
      return extractTokenFromCookie(decodedValue);
    }

    const altUrl = twentyUrl.includes('://www.')
      ? twentyUrl.replace('://www.', '://')
      : twentyUrl.replace('://', '://www.');

    const altCookie = await browser.cookies.get({
      url: altUrl,
      name: 'tokenPair',
    });

    console.log('Alt cookie lookup for', altUrl, ':', altCookie ? 'found' : 'not found');

    if (altCookie?.value) {
      const decodedValue = decodeURIComponent(altCookie.value);
      return extractTokenFromCookie(decodedValue);
    }

    return null;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
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
    console.error('Error searching by LinkedIn URL:', error);
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
      console.error('Error searching by name:', error);
    }
  }

  return { exists: false };
}

// Check if a company already exists (by LinkedIn URL or name)
async function checkCompanyDuplicate(
  client: TwentyApiClient,
  linkedinUrl: string,
  companyName?: string
): Promise<{ exists: boolean; record?: { id: string; type: string }; matchedBy?: string }> {
  // First, try to find by LinkedIn URL
  try {
    const companyByLinkedIn = await client.findCompanyByLinkedInUrl(linkedinUrl);
    if (companyByLinkedIn) {
      console.log('Found company by LinkedIn URL:', companyByLinkedIn.id);
      return { exists: true, record: { id: companyByLinkedIn.id, type: 'company' }, matchedBy: 'linkedin' };
    }
  } catch (error) {
    console.error('Error searching company by LinkedIn URL:', error);
  }

  // If not found by LinkedIn URL and we have name, try by name
  if (companyName) {
    try {
      const companyByName = await client.findCompanyByName(companyName);
      if (companyByName) {
        console.log('Found company by name:', companyByName.id, companyByName.name);
        return { exists: true, record: { id: companyByName.id, type: 'company' }, matchedBy: 'name' };
      }
    } catch (error) {
      console.error('Error searching company by name:', error);
    }
  }

  return { exists: false };
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

// Test connection to Twenty
async function testConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const client = await getApiClient();
    const connected = await client.testConnection();
    if (!connected) {
      return { connected: false, error: 'Failed to connect to Twenty API. Please check your URL and ensure you are logged in.' };
    }
    return { connected: true };
  } catch (err) {
    console.error('Test connection failed:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // Provide more specific error messages
    if (errorMessage.includes('not configured')) {
      return { connected: false, error: 'Twenty URL is not configured. Please enter your Twenty URL.' };
    }
    if (errorMessage.includes('No authentication token') || errorMessage.includes('No authentication')) {
      return { connected: false, error: 'Not logged in. Please open your Twenty instance and log in, then try again.' };
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
      case 'GET_AUTH_TOKEN': {
        const settings = await getSettings();
        if (!settings.twentyUrl) {
          return { success: false, error: 'Twenty URL not configured' };
        }
        const token = await getAuthToken(settings.twentyUrl);
        return { success: !!token, data: { hasToken: !!token } };
      }

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
        const result = await createRecord(data);
        return { success: true, data: result };
      }

      case 'GET_SETTINGS': {
        const settings = await getSettings();
        const hasToken = settings.twentyUrl
          ? !!(await getAuthToken(settings.twentyUrl))
          : false;
        return {
          success: true,
          data: { ...settings, hasToken }
        };
      }

      case 'SAVE_SETTINGS': {
        const newSettings = message.payload as { twentyUrl?: string };
        console.log('Saving settings:', newSettings);
        await saveSettings(newSettings);
        // Clear cached client when URL changes
        if (newSettings.twentyUrl) {
          apiClient = null;
          cachedTwentyUrl = null;
        }
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
        await client.updateRecordWithLinkedInData(id, type, data);
        return { success: true, data: { id } };
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

      default:
        return { success: false, error: 'Unknown message type' };
    }
  } catch (error) {
    console.error('Background error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
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

  try {
    if (browser.action && browser.action.onClicked) {
      browser.action.onClicked.addListener((tab) => {
        if (tab?.id && browser.sidePanel) {
          browser.sidePanel.open({ tabId: tab.id });
        }
      });
    }
  } catch (error) {
    console.warn('Could not set up action onClicked listener:', error);
  }
  console.log('Twenty CRM Extension background loaded');
});

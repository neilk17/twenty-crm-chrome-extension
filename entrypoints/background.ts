import { TwentyApiClient, extractTokenFromCookie } from '../lib/twenty-api';
import { getSettings, saveSettings, addToRecentCaptures, getRecentCaptures } from '../lib/storage';
import { track } from '../lib/analytics';
import { getNormalizedDomain } from '../lib/domain-extractor';
import type { ExtensionMessage, ExtensionResponse, LinkedInProfileData, LinkedInCompanyData, DomainCompanyData } from '../types';

// Cache for API client
let apiClient: TwentyApiClient | null = null;
let cachedTwentyUrl: string | null = null;
let cachedAuthToken: { apiBaseUrl: string; token: string; checkedAt: number } | null = null;

const AUTH_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

function parseTwentyUrl(twentyUrl: string): URL | null {
  const normalized = twentyUrl.trim();
  if (!normalized) return null;

  const withProtocol = /^https?:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`;

  try {
    return new URL(withProtocol);
  } catch {
    return null;
  }
}

function isOfficialTwentyCloudHost(hostname: string): boolean {
  return hostname === 'twenty.com'
    || hostname === 'www.twenty.com'
    || hostname === 'app.twenty.com'
    || hostname === 'api.twenty.com';
}

function normalizeTwentyUrlForStorage(twentyUrl: string): string {
  const parsed = parseTwentyUrl(twentyUrl);
  if (!parsed) {
    return twentyUrl.trim().replace(/\/$/, '');
  }

  const normalizedHost = parsed.hostname.toLowerCase();
  if (normalizedHost === 'twenty.com' || normalizedHost === 'www.twenty.com') {
    return `${parsed.protocol}//app.twenty.com`;
  }

  const normalizedPath = parsed.pathname && parsed.pathname !== '/'
    ? parsed.pathname.replace(/\/$/, '')
    : '';
  return `${parsed.protocol}//${parsed.hostname}${normalizedPath}`;
}

function resolveTwentyApiBaseUrl(twentyUrl: string): string {
  const parsed = parseTwentyUrl(twentyUrl);
  if (!parsed) {
    return twentyUrl.trim().replace(/\/$/, '');
  }

  const hostname = parsed.hostname.toLowerCase();

  if (isOfficialTwentyCloudHost(hostname)) {
    return `${parsed.protocol}//api.twenty.com`;
  }

  const normalizedPath = parsed.pathname && parsed.pathname !== '/'
    ? parsed.pathname.replace(/\/$/, '')
    : '';
  return `${parsed.origin}${normalizedPath}`;
}

function isAuthGraphQLError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('unauthorized')
    || normalized.includes('authentication')
    || normalized.includes('forbidden')
    || normalized.includes('invalid token')
    || normalized.includes('jwt')
    || normalized.includes('access denied');
}

async function validateTokenForApi(apiBaseUrl: string, token: string): Promise<boolean> {
  const probes = [
    `query { currentUser { id } }`,
    `query { currentWorkspace { id } }`,
    `query { people(first: 1) { edges { node { id } } } }`,
  ];

  for (const query of probes) {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query }),
      });
    } catch {
      return false;
    }

    if (response.status === 401 || response.status === 403) {
      return false;
    }

    if (!response.ok) {
      continue;
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      continue;
    }

    const errors = (result as { errors?: Array<{ message?: string }> })?.errors || [];
    if (!errors.length) {
      return true;
    }

    const errorText = errors
      .map((error) => error?.message || '')
      .filter(Boolean)
      .join(' | ');

    if (isAuthGraphQLError(errorText)) {
      return false;
    }

    // Non-auth GraphQL errors still prove the token is accepted.
    return true;
  }

  return false;
}

// Get or create API client
async function getApiClient(): Promise<TwentyApiClient> {
  const settings = await getSettings();

  if (!settings.twentyUrl) {
    throw new Error('Twenty URL not configured');
  }

  const apiBaseUrl = resolveTwentyApiBaseUrl(settings.twentyUrl);

  // Create new client if URL changed
  if (cachedTwentyUrl !== apiBaseUrl || !apiClient) {
    apiClient = new TwentyApiClient(apiBaseUrl);
    cachedTwentyUrl = apiBaseUrl;
  }

  // Get fresh token from cookie
  const token = await getAuthToken(settings.twentyUrl);
  if (!token) {
    throw new Error('No authentication token found. Please log in to Twenty CRM.');
  }

  apiClient.setToken(token);
  return apiClient;
}

function getTwentyCookieUrls(twentyUrl: string): string[] {
  const parsed = parseTwentyUrl(twentyUrl);
  if (!parsed) {
    const normalized = twentyUrl.trim().replace(/\/$/, '');
    return normalized ? [normalized] : [];
  }

  const protocol = parsed.protocol;
  const hostname = parsed.hostname.toLowerCase();
  const hostnames = new Set<string>([hostname]);

  if (hostname.startsWith('www.')) {
    hostnames.add(hostname.replace(/^www\./, ''));
  } else {
    hostnames.add(`www.${hostname}`);
  }

  if (isOfficialTwentyCloudHost(hostname)) {
    hostnames.add('twenty.com');
    hostnames.add('www.twenty.com');
    hostnames.add('app.twenty.com');
    hostnames.add('api.twenty.com');
  }

  return Array.from(hostnames).map((host) => `${protocol}//${host}`);
}

// Get auth token from Twenty's cookie
async function getAuthToken(twentyUrl: string): Promise<string | null> {
  try {
    const apiBaseUrl = resolveTwentyApiBaseUrl(twentyUrl);
    const cookieUrls = getTwentyCookieUrls(twentyUrl);
    const cookieNames = ['tokenPair', 'accessToken', 'access-token'];
    const tokenCandidates: string[] = [];
    let checkedPermittedHost = false;

    for (const url of cookieUrls) {
      const hasHostPermission = await browser.permissions.contains({ origins: [`${url}/*`] });
      if (!hasHostPermission) {
        continue;
      }

      checkedPermittedHost = true;
      for (const cookieName of cookieNames) {
        const cookie = await browser.cookies.get({
          url,
          name: cookieName,
        });

        console.log('Cookie lookup for', url, cookieName, ':', cookie ? 'found' : 'not found');

        if (!cookie?.value) {
          continue;
        }

        const token = extractTokenFromCookie(cookie.value);
        if (token) {
          if (!tokenCandidates.includes(token)) {
            tokenCandidates.push(token);
          }
          console.log('Successfully extracted token candidate from cookie', cookieName, 'for', url);
          continue;
        }

        console.warn('Cookie found but token extraction failed for', url, cookieName);
      }
    }

    if (!checkedPermittedHost) {
      throw new Error('Missing host permission for your Twenty URL. Click Save or Test Connection and allow access.');
    }

    if (tokenCandidates.length === 0) {
      return null;
    }

    if (
      cachedAuthToken
      && cachedAuthToken.apiBaseUrl === apiBaseUrl
      && (Date.now() - cachedAuthToken.checkedAt) < AUTH_TOKEN_CACHE_TTL_MS
      && tokenCandidates.includes(cachedAuthToken.token)
    ) {
      return cachedAuthToken.token;
    }

    for (const candidateToken of tokenCandidates) {
      const valid = await validateTokenForApi(apiBaseUrl, candidateToken);
      if (valid) {
        cachedAuthToken = {
          apiBaseUrl,
          token: candidateToken,
          checkedAt: Date.now(),
        };
        console.log('Validated auth token candidate for', apiBaseUrl);
        return candidateToken;
      }
    }

    console.warn('Could not validate token candidates; using first extracted token as fallback.');
    return tokenCandidates[0];
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
      console.error('Error searching company by LinkedIn URL:', error);
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
      console.error('Error searching company by domain:', error);
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
      console.error('Error searching company by name:', error);
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

  // Create company data with domain
  const companyData: DomainCompanyData = {
    type: 'company',
    domain,
    name: companyName || domain, // Use domain as name if no name provided
  };

  // Convert to LinkedInCompanyData format for API (without LinkedIn URL)
  const apiData: LinkedInCompanyData = {
    type: 'company',
    linkedinUrl: '', // Empty LinkedIn URL for domain-only companies
    name: companyData.name || domain,
    website: `https://${domain}`, // Use domain as website URL
  };

  const company = await client.createCompany(apiData);

  // Save to recent captures (using domain as identifier since there's no LinkedIn URL)
  await addToRecentCaptures({
    linkedinUrl: `domain:${domain}`, // Use domain as identifier
    name: company.name,
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
    if (errorMessage.includes('Missing host permission')) {
      return { connected: false, error: 'Permission required. Click "Test Connection" again and allow access to your Twenty domain.' };
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
        try {
          const result = await createRecord(data);
          track('capture_created', { type: data.type, success: true });
          return { success: true, data: result };
        } catch (err) {
          track('capture_created', { type: data.type, success: false });
          throw err;
        }
      }

      case 'GET_SETTINGS': {
        const settings = await getSettings();
        const normalizedTwentyUrl = settings.twentyUrl
          ? normalizeTwentyUrlForStorage(settings.twentyUrl)
          : settings.twentyUrl;
        const hasToken = settings.twentyUrl
          ? !!(await getAuthToken(settings.twentyUrl))
          : false;
        return {
          success: true,
          data: { ...settings, twentyUrl: normalizedTwentyUrl, hasToken }
        };
      }

      case 'SAVE_SETTINGS': {
        const newSettings = message.payload as { twentyUrl?: string };
        const normalizedSettings = {
          ...newSettings,
          twentyUrl: newSettings.twentyUrl
            ? normalizeTwentyUrlForStorage(newSettings.twentyUrl)
            : newSettings.twentyUrl,
        };
        console.log('Saving settings:', normalizedSettings);
        await saveSettings(normalizedSettings);
        // Clear cached client when URL changes
        if (newSettings.twentyUrl) {
          apiClient = null;
          cachedTwentyUrl = null;
          cachedAuthToken = null;
        }
        console.log('Settings saved successfully');
        track('settings_saved', {});
        return { success: true };
      }

      case 'TEST_CONNECTION': {
        const result = await testConnection();
        if (result.connected) {
          track('connection_tested', { success: true });
          return { success: true, data: { connected: true } };
        } else {
          track('connection_tested', { success: false });
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
          track('capture_updated', { type, success: true });
          return { success: true, data: { id } };
        } catch (err) {
          track('capture_updated', { type, success: false });
          throw err;
        }
      }

      case 'SCRAPE_PAGE': {
        const { tabId } = message.payload as { tabId: number };
        try {
          // Cross-browser script execution
          const scrapeFunc = () => {
            const linkedinUrl = window.location.href.split('?')[0];
            const isPerson = linkedinUrl.includes('linkedin.com/in/');
            const isCompany = linkedinUrl.includes('linkedin.com/company/');

            if (!isPerson && !isCompany) {
              return { type: null, data: null };
            }

            return {
              type: isPerson ? 'person' : 'company',
              url: linkedinUrl,
            };
          };

          let result;
          // Chrome MV3 uses browser.scripting, Firefox MV2 uses browser.tabs.executeScript
          if (browser.scripting?.executeScript) {
            const results = await browser.scripting.executeScript({
              target: { tabId },
              func: scrapeFunc,
            });
            result = results?.[0]?.result;
          } else {
            // Firefox MV2 fallback
            const results = await browser.tabs.executeScript(tabId, {
              code: `(${scrapeFunc.toString()})()`,
            });
            result = results?.[0];
          }

          if (result) {
            return { success: true, data: result };
          }
          return { success: false, error: 'Could not scrape page' };
        } catch (error) {
          console.error('Error scraping page:', error);
          return { success: false, error: 'Could not access page' };
        }
      }

      case 'GET_DOMAIN_FROM_PAGE': {
        const { tabId } = message.payload as { tabId: number };
        try {
          // Try to get domain from content script first
          try {
            const response = await browser.tabs.sendMessage(tabId, {
              type: 'GET_DOMAIN_FROM_PAGE',
            });
            if (response && response.success) {
              return { success: true, data: response.data };
            }
          } catch (e) {
            // Content script might not be loaded, fall back to extracting from tab URL
            console.log('Could not get domain from content script, extracting from tab URL');
          }

          // Fallback: extract domain from tab URL
          const tab = await browser.tabs.get(tabId);
          if (tab.url) {
            const domain = getNormalizedDomain(tab.url);
            if (domain) {
              return { success: true, data: { domain, url: tab.url } };
            }
          }
          return { success: false, error: 'Could not extract domain from URL' };
        } catch (error) {
          console.error('Error getting domain from page:', error);
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
      || errorMessage.includes('No authentication token');

    if (!isExpectedSetupState) {
      console.error('Background error:', error);
      if (isAuthGraphQLError(errorMessage)) {
        track('error_occurred', { context: message.type, kind: 'auth' });
      } else {
        track('error_occurred', { context: message.type, kind: 'general' });
      }
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
      // Chrome MV3: use sidePanel API
      (browser.sidePanel as any).setPanelBehavior({ openPanelOnActionClick: true });
    } else if (browser.sidebarAction) {
      // Firefox: toggle sidebar on toolbar icon click
      browser.browserAction.onClicked.addListener(() => {
        browser.sidebarAction.toggle();
      });
    }
  } catch (error) {
    console.warn('Could not set side panel behavior:', error);
  }
  console.log('Twenty CRM Extension background loaded');
});

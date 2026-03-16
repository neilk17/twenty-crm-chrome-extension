import {
  TwentyApiClient,
  extractTokenFromCookie,
  isTwentyAuthErrorMessage,
} from '../lib/twenty-api';
import { getSettings, saveSettings, addToRecentCaptures, getRecentCaptures } from '../lib/storage';
import { getNormalizedDomain } from '../lib/domain-extractor';
import {
  getTwentyCookieUrls,
  normalizeTwentyUrl,
  resolveTwentyApiBaseUrl,
} from '../lib/twenty-url';
import type { ExtensionMessage, ExtensionResponse, LinkedInProfileData, LinkedInCompanyData, DomainCompanyData } from '../types';

// Cache for API client
let apiClient: TwentyApiClient | null = null;
let cachedTwentyUrl: string | null = null;
let cachedAuthToken: { apiBaseUrl: string; token: string; checkedAt: number } | null = null;

const AUTH_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

type TokenValidationResult = 'valid' | 'invalid' | 'inconclusive';

function isTokenExpired(token: string): boolean {
  try {
    const [, payload] = token.split('.');
    if (!payload) {
      return false;
    }

    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded) as { exp?: unknown };

    if (typeof parsed.exp !== 'number') {
      return false;
    }

    return (parsed.exp * 1000) <= (Date.now() + 30 * 1000);
  } catch {
    return false;
  }
}

function isAuthError(error: unknown): boolean {
  return error instanceof Error && isTwentyAuthErrorMessage(error.message);
}

async function validateTokenForApi(apiBaseUrl: string, token: string): Promise<TokenValidationResult> {
  const probes = [
    `query { currentUser { id } }`,
    `query { currentWorkspace { id } }`,
    `query { people(first: 1) { edges { node { id } } } }`,
  ];

  let sawInconclusiveProbe = false;

  const performRequest = async (bearerToken: string | null, query: string): Promise<Response> =>
    fetch(`${apiBaseUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ query }),
    });

  for (const query of probes) {
    let response: Response;
    try {
      response = await performRequest(token, query);

      // Mirror the request path used by the API client: some deployments rely on cookie auth.
      if (response.status === 401 || response.status === 403) {
        response = await performRequest(null, query);
      }
    } catch {
      sawInconclusiveProbe = true;
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      return 'invalid';
    }

    if (!response.ok) {
      sawInconclusiveProbe = true;
      continue;
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      sawInconclusiveProbe = true;
      continue;
    }

    const errors = (result as { errors?: Array<{ message?: string }> })?.errors || [];
    if (!errors.length) {
      return 'valid';
    }

    const errorText = errors
      .map((error) => error?.message || '')
      .filter(Boolean)
      .join(' | ');

    if (isTwentyAuthErrorMessage(errorText)) {
      return 'invalid';
    }

    // Non-auth GraphQL errors still prove the token is accepted.
    return 'valid';
  }

  return sawInconclusiveProbe ? 'inconclusive' : 'invalid';
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

  // Get fresh token from cookie
  const token = await getAuthToken(settings.twentyUrl);
  if (!token) {
    throw new Error('No authentication token found. Please log in to Twenty CRM.');
  }

  apiClient.setToken(token);
  return apiClient;
}

// Get auth token from Twenty's cookie
async function getAuthToken(twentyUrl: string): Promise<string | null> {
  try {
    const apiBaseUrl = resolveTwentyApiBaseUrl(twentyUrl);
    if (!apiBaseUrl) {
      throw new Error('Invalid Twenty URL. Enter your full Twenty workspace URL.');
    }
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
      && !isTokenExpired(cachedAuthToken.token)
      && tokenCandidates.includes(cachedAuthToken.token)
    ) {
      return cachedAuthToken.token;
    }

    let sawInconclusiveValidation = false;
    for (const candidateToken of tokenCandidates) {
      const validationResult = await validateTokenForApi(apiBaseUrl, candidateToken);
      if (validationResult === 'valid') {
        cachedAuthToken = {
          apiBaseUrl,
          token: candidateToken,
          checkedAt: Date.now(),
        };
        console.log('Validated auth token candidate for', apiBaseUrl);
        return candidateToken;
      }

      if (validationResult === 'inconclusive') {
        sawInconclusiveValidation = true;
      }
    }

    cachedAuthToken = null;
    if (sawInconclusiveValidation) {
      console.warn('Could not validate token candidates conclusively; using first extracted token as fallback.');
      return tokenCandidates[0];
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
      return { connected: false, error: 'Failed to connect to Twenty API. Please check your URL and ensure you are logged in.' };
    }
    return { connected: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    if (isTwentyAuthErrorMessage(errorMessage) || errorMessage.includes('No authentication token')) {
      console.info('Test connection requires an active Twenty session.');
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
        const hasToken = normalizedTwentyUrl
          ? !!(await getAuthToken(normalizedTwentyUrl))
          : false;
        return {
          success: true,
          data: {
            ...settings,
            twentyUrl: normalizedTwentyUrl || '',
            invalidTwentyUrl,
            hasToken,
          }
        };
      }

      case 'SAVE_SETTINGS': {
        const newSettings = message.payload as { twentyUrl?: string };
        const validatedTwentyUrl = newSettings.twentyUrl
          ? normalizeTwentyUrl(newSettings.twentyUrl)
          : newSettings.twentyUrl;
        if (newSettings.twentyUrl && !validatedTwentyUrl) {
          return {
            success: false,
            error: 'Enter a valid Twenty URL, for example https://app.twenty.com or https://crm.example.com.'
          };
        }
        const normalizedSettings = newSettings.twentyUrl
          ? {
              ...newSettings,
              twentyUrl: validatedTwentyUrl as string,
            }
          : newSettings;
        console.log('Saving settings:', normalizedSettings);
        await saveSettings(normalizedSettings);
        // Clear cached client when URL changes
        if (newSettings.twentyUrl) {
          apiClient = null;
          cachedTwentyUrl = null;
          cachedAuthToken = null;
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
      || errorMessage.includes('No authentication token')
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

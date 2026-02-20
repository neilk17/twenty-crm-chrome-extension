import type {
  TwentyTokenPair,
  GraphQLResponse,
  PeopleQueryResult,
  CompaniesQueryResult,
  CreatePersonResult,
  CreateCompanyResult,
  LinkedInProfileData,
  LinkedInCompanyData,
} from '../types';

// GraphQL Queries - Using correct Links composite field structure
// Links type has: primaryLinkUrl, primaryLinkLabel, secondaryLinks
const FIND_PERSON_BY_LINKEDIN = `
  query FindPersonByLinkedIn($filter: PersonFilterInput) {
    people(filter: $filter, first: 1) {
      edges {
        node {
          id
          name {
            firstName
            lastName
          }
          linkedinLink {
            primaryLinkUrl
            primaryLinkLabel
          }
          jobTitle
          avatarUrl
          city
          company {
            id
            name
          }
        }
      }
    }
  }
`;

const FIND_COMPANY_BY_LINKEDIN = `
  query FindCompanyByLinkedIn($filter: CompanyFilterInput) {
    companies(filter: $filter, first: 1) {
      edges {
        node {
          id
          name
          linkedinLink {
            primaryLinkUrl
            primaryLinkLabel
          }
          domainName {
            primaryLinkUrl
            primaryLinkLabel
          }
          employees
        }
      }
    }
  }
`;

const FIND_COMPANY_BY_NAME = `
  query FindCompanyByName($filter: CompanyFilterInput) {
    companies(filter: $filter, first: 5) {
      edges {
        node {
          id
          name
          linkedinLink {
            primaryLinkUrl
          }
        }
      }
    }
  }
`;

const FIND_PERSON_BY_NAME = `
  query FindPersonByName($filter: PersonFilterInput) {
    people(filter: $filter, first: 5) {
      edges {
        node {
          id
          name {
            firstName
            lastName
          }
          linkedinLink {
            primaryLinkUrl
          }
          jobTitle
          company {
            id
            name
          }
        }
      }
    }
  }
`;

const SEARCH_PEOPLE = `
  query SearchPeople($filter: PersonFilterInput) {
    people(filter: $filter, first: 10) {
      edges {
        node {
          id
          name {
            firstName
            lastName
          }
          jobTitle
          company {
            id
            name
          }
        }
      }
    }
  }
`;

const SEARCH_COMPANIES = `
  query SearchCompanies($filter: CompanyFilterInput) {
    companies(filter: $filter, first: 10) {
      edges {
        node {
          id
          name
          domainName {
            primaryLinkUrl
          }
        }
      }
    }
  }
`;

const UPDATE_PERSON = `
  mutation UpdatePerson($id: UUID!, $input: PersonUpdateInput!) {
    updatePerson(id: $id, data: $input) {
      id
      name {
        firstName
        lastName
      }
    }
  }
`;

const UPDATE_COMPANY = `
  mutation UpdateCompany($id: UUID!, $input: CompanyUpdateInput!) {
    updateCompany(id: $id, data: $input) {
      id
      name
    }
  }
`;

const CREATE_PERSON = `
  mutation CreatePerson($input: PersonCreateInput!) {
    createPerson(data: $input) {
      id
      name {
        firstName
        lastName
      }
      linkedinLink {
        primaryLinkUrl
      }
      company {
        id
        name
      }
    }
  }
`;

const CREATE_COMPANY = `
  mutation CreateCompany($input: CompanyCreateInput!) {
    createCompany(data: $input) {
      id
      name
      linkedinLink {
        primaryLinkUrl
      }
    }
  }
`;

function isHttpUrl(value?: string): boolean {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatGraphQLErrors(
  errors: Array<{ message?: string; path?: string[] }> | undefined
): string {
  if (!errors || errors.length === 0) {
    return 'Unknown GraphQL error';
  }

  return errors
    .map((error) => {
      const message = error.message || 'Unknown error';
      const path = error.path?.length ? ` (path: ${error.path.join('.')})` : '';
      return `${message}${path}`;
    })
    .join('; ');
}

export class TwentyApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string) {
    this.token = token;
  }

  // Upload an image via GraphQL multipart upload
  async uploadImageViaGraphQL(imageUrl: string, filename?: string): Promise<string | null> {
    if (!this.token) {
      console.error('[Twenty] No authentication token set for image upload');
      return null;
    }

    if (!isHttpUrl(imageUrl)) {
      console.warn('[Twenty] Skipping image upload: invalid image URL', imageUrl);
      return null;
    }

    console.log('[Twenty] Starting image upload from:', imageUrl);

    try {
      // Fetch the image
      console.log('[Twenty] Fetching image...');
      const response = await fetch(imageUrl);
      if (!response.ok) {
        console.error('[Twenty] Failed to fetch image:', response.status, response.statusText);
        return null;
      }

      const blob = await response.blob();
      console.log('[Twenty] Image fetched, size:', blob.size, 'type:', blob.type);

      const finalFilename = filename || `profile-${Date.now()}.jpg`;

      // GraphQL multipart upload format (Apollo Upload spec)
      // https://github.com/jaydenseric/graphql-multipart-request-spec
      const operations = JSON.stringify({
        query: `
          mutation UploadImage($file: Upload!, $fileFolder: FileFolder) {
            uploadImage(file: $file, fileFolder: $fileFolder) {
              path
              token
            }
          }
        `,
        variables: {
          file: null,
          fileFolder: 'PersonPicture',
        },
      });

      const map = JSON.stringify({
        '0': ['variables.file'],
      });

      const formData = new FormData();
      formData.append('operations', operations);
      formData.append('map', map);
      formData.append('0', blob, finalFilename);

      const uploadUrl = `${this.baseUrl}/graphql`;
      console.log('[Twenty] Uploading via GraphQL to:', uploadUrl);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        body: formData,
      });

      console.log('[Twenty] Upload response status:', uploadResponse.status);

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[Twenty] Failed to upload image:', uploadResponse.status, errorText);
        return null;
      }

      const result = await uploadResponse.json();
      console.log('[Twenty] Upload result:', result);

      if (result.errors?.length) {
        console.warn('[Twenty] Image upload GraphQL errors:', formatGraphQLErrors(result.errors));
        return null;
      }

      // Return just the path - Twenty stores paths, not full URLs with tokens
      // The server will handle authentication when serving the image
      const uploadData = result.data?.uploadImage;
      if (uploadData?.path) {
        // Store just the path - Twenty's frontend will request with fresh tokens
        const avatarPath = uploadData.path;
        console.log('[Twenty] Image uploaded successfully, path:', avatarPath);
        return avatarPath;
      }

      console.warn('[Twenty] Upload succeeded but no path/token in response:', result);
      return null;
    } catch (error) {
      console.error('[Twenty] Error uploading image:', error);
      return null;
    }
  }

  private async graphqlRequest<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> {
    const performRequest = async (token: string | null): Promise<Response> =>
      fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ query, variables }),
      });

    let response: Response;
    try {
      response = await performRequest(this.token);

      // Some Twenty deployments rely on cookie-based auth; retry without bearer once.
      if ((response.status === 401 || response.status === 403) && this.token) {
        console.warn('[Twenty] Bearer auth rejected, retrying request with cookie credentials only.');
        response = await performRequest(null);
      }
    } catch (error) {
      // Network error (CORS, DNS, etc.)
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Cannot connect to ${this.baseUrl}. Please check your URL and ensure it is accessible.`);
      }
      throw error;
    }

    if (!response.ok) {
      let errorMessage = `HTTP error: ${response.status}`;
      if (response.status === 401 || response.status === 403) {
        errorMessage = 'Authentication failed. Please log in to your Twenty instance.';
      } else if (response.status === 404) {
        errorMessage = `GraphQL endpoint not found at ${this.baseUrl}/graphql. Please check your URL.`;
      } else if (response.status >= 500) {
        errorMessage = 'Server error. Please try again later.';
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  private isAuthGraphQLError(errorMessage: string): boolean {
    const normalized = errorMessage.toLowerCase();
    return normalized.includes('unauthorized')
      || normalized.includes('authentication')
      || normalized.includes('token')
      || normalized.includes('forbidden');
  }

  private isSchemaCompatibilityError(errorMessage: string): boolean {
    const normalized = errorMessage.toLowerCase();
    return normalized.includes('cannot query field')
      || normalized.includes('unknown type')
      || normalized.includes('unknown argument');
  }

  async findPersonByLinkedInUrl(
    linkedinUrl: string
  ): Promise<PeopleQueryResult['people']['edges'][0]['node'] | null> {
    const normalizedUrl = this.normalizeLinkedInUrl(linkedinUrl);

    const result = await this.graphqlRequest<PeopleQueryResult>(
      FIND_PERSON_BY_LINKEDIN,
      {
        filter: {
          linkedinLink: {
            primaryLinkUrl: {
              ilike: `%${normalizedUrl}%`,
            },
          },
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    return result.data?.people.edges[0]?.node || null;
  }

  async findCompanyByLinkedInUrl(
    linkedinUrl: string
  ): Promise<CompaniesQueryResult['companies']['edges'][0]['node'] | null> {
    const normalizedUrl = this.normalizeLinkedInUrl(linkedinUrl);

    const result = await this.graphqlRequest<CompaniesQueryResult>(
      FIND_COMPANY_BY_LINKEDIN,
      {
        filter: {
          linkedinLink: {
            primaryLinkUrl: {
              ilike: `%${normalizedUrl}%`,
            },
          },
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    return result.data?.companies.edges[0]?.node || null;
  }

  async findCompanyByName(
    companyName: string
  ): Promise<CompaniesQueryResult['companies']['edges'][0]['node'] | null> {
    // Search for company by name (case-insensitive)
    const result = await this.graphqlRequest<CompaniesQueryResult>(
      FIND_COMPANY_BY_NAME,
      {
        filter: {
          name: {
            ilike: `%${companyName}%`,
          },
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    // Try to find exact match first (case-insensitive)
    const companies = result.data?.companies.edges || [];
    const exactMatch = companies.find(
      (c) => c.node.name.toLowerCase() === companyName.toLowerCase()
    );

    if (exactMatch) {
      return exactMatch.node;
    }

    // Return first partial match if no exact match
    return companies[0]?.node || null;
  }

  async findPersonByName(
    firstName: string,
    lastName: string
  ): Promise<PeopleQueryResult['people']['edges'][0]['node'] | null> {
    // Search for person by first and last name
    const result = await this.graphqlRequest<PeopleQueryResult>(
      FIND_PERSON_BY_NAME,
      {
        filter: {
          and: [
            {
              name: {
                firstName: {
                  ilike: `%${firstName}%`,
                },
              },
            },
            {
              name: {
                lastName: {
                  ilike: `%${lastName}%`,
                },
              },
            },
          ],
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    // Try to find exact match first (case-insensitive)
    const people = result.data?.people.edges || [];
    const exactMatch = people.find(
      (p) =>
        p.node.name.firstName.toLowerCase() === firstName.toLowerCase() &&
        p.node.name.lastName.toLowerCase() === lastName.toLowerCase()
    );

    if (exactMatch) {
      return exactMatch.node;
    }

    // Return first partial match if no exact match
    return people[0]?.node || null;
  }

  async findOrCreateCompany(
    companyName: string
  ): Promise<{ id: string; name: string; created: boolean }> {
    // First, try to find existing company by name
    const existingCompany = await this.findCompanyByName(companyName);

    if (existingCompany) {
      console.log('Found existing company:', existingCompany.name);
      return { id: existingCompany.id, name: existingCompany.name, created: false };
    }

    // Create new company if not found
    console.log('Creating new company:', companyName);
    const newCompany = await this.createCompanySimple(companyName);
    return { id: newCompany.id, name: newCompany.name, created: true };
  }

  // Simple company creation (just name, no LinkedIn URL)
  private async createCompanySimple(
    name: string
  ): Promise<CreateCompanyResult['createCompany']> {
    const result = await this.graphqlRequest<CreateCompanyResult>(
      CREATE_COMPANY,
      {
        input: {
          name,
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    if (!result.data?.createCompany) {
      throw new Error('Failed to create company');
    }

    return result.data.createCompany;
  }

  async createPerson(
    data: LinkedInProfileData
  ): Promise<CreatePersonResult['createPerson'] & { companyCreated?: boolean }> {
    let companyId: string | undefined;
    let companyCreated = false;

    // If person has a company, find or create it first
    console.log('[Twenty] createPerson - currentCompany:', data.currentCompany);
    if (data.currentCompany) {
      console.log('[Twenty] Attempting to find or create company:', data.currentCompany);
      try {
        const companyResult = await this.findOrCreateCompany(data.currentCompany);
        companyId = companyResult.id;
        companyCreated = companyResult.created;
        console.log(`[Twenty] Company ${companyResult.created ? 'created' : 'found'}:`, companyResult.name, 'id:', companyId);
      } catch (error) {
        console.error('[Twenty] Error finding/creating company:', error);
        // Continue without company link if this fails
      }
    } else {
      console.log('[Twenty] No currentCompany in data, skipping company creation');
    }

    // Try to upload profile image to Twenty storage
    let avatarUrl = isHttpUrl(data.profileImageUrl) ? data.profileImageUrl : '';
    if (data.profileImageUrl) {
      console.log('[Twenty] Attempting to upload profile image...');
      try {
        const uploadedUrl = await this.uploadImageViaGraphQL(
          data.profileImageUrl,
          `${data.firstName}-${data.lastName}-profile.jpg`
        );
        if (uploadedUrl) {
          avatarUrl = uploadedUrl;
          console.log('[Twenty] Profile image uploaded, using:', avatarUrl);
        } else {
          console.log('[Twenty] Upload failed, using LinkedIn URL directly');
        }
      } catch (error) {
        console.error('[Twenty] Error uploading profile image:', error);
      }
    }

    const result = await this.graphqlRequest<CreatePersonResult>(CREATE_PERSON, {
      input: {
        name: {
          firstName: data.firstName,
          lastName: data.lastName,
        },
        linkedinLink: {
          primaryLinkUrl: data.linkedinUrl,
          primaryLinkLabel: 'LinkedIn',
        },
        jobTitle: data.headline || '',
        avatarUrl: avatarUrl,
        city: data.location || '',
        // Link to company if we found/created one
        companyId: companyId,
      },
    });

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    if (!result.data?.createPerson) {
      throw new Error('Failed to create person');
    }

    return { ...result.data.createPerson, companyCreated };
  }

  async createCompany(
    data: LinkedInCompanyData
  ): Promise<CreateCompanyResult['createCompany']> {
    const result = await this.graphqlRequest<CreateCompanyResult>(
      CREATE_COMPANY,
      {
        input: {
          name: data.name,
          linkedinLink: {
            primaryLinkUrl: data.linkedinUrl,
            primaryLinkLabel: 'LinkedIn',
          },
          domainName: data.website
            ? {
              primaryLinkUrl: data.website,
              primaryLinkLabel: 'Website',
            }
            : undefined,
          employees: data.employeeCount
            ? this.parseEmployeeCount(data.employeeCount)
            : undefined,
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    if (!result.data?.createCompany) {
      throw new Error('Failed to create company');
    }

    return result.data.createCompany;
  }

  async testConnection(): Promise<boolean> {
    try {
      const probes: Array<{
        name: string;
        query: string;
        isValid: (data: unknown) => boolean;
      }> = [
        {
          name: 'currentWorkspace',
          query: `query { currentWorkspace { id } }`,
          isValid: (data) => !!(data as { currentWorkspace?: { id?: string } })?.currentWorkspace?.id,
        },
        {
          name: 'currentUser',
          query: `query { currentUser { id } }`,
          isValid: (data) => !!(data as { currentUser?: { id?: string } })?.currentUser?.id,
        },
        {
          name: 'people',
          query: `query { people(first: 1) { edges { node { id } } } }`,
          isValid: (data) => Array.isArray((data as { people?: { edges?: unknown[] } })?.people?.edges),
        },
      ];

      let sawSchemaCompatibilityError = false;
      let lastSchemaError: string | null = null;
      let lastOtherError: string | null = null;

      for (const probe of probes) {
        const result = await this.graphqlRequest<unknown>(probe.query);

        if (result.errors?.length) {
          const errorMessage = result.errors[0].message;

          if (this.isAuthGraphQLError(errorMessage)) {
            throw new Error('Authentication failed. Please log in to your Twenty instance.');
          }

          if (this.isSchemaCompatibilityError(errorMessage)) {
            sawSchemaCompatibilityError = true;
            lastSchemaError = errorMessage;
            console.warn(`[Twenty] Connection probe "${probe.name}" not supported:`, errorMessage);
            continue;
          }

          lastOtherError = errorMessage;
          console.error('[Twenty] Connection test GraphQL errors:', errorMessage);
          continue;
        }

        if (probe.isValid(result.data)) {
          return true;
        }
      }

      if (sawSchemaCompatibilityError) {
        console.error('[Twenty] Connection test failed: no compatible probe succeeded.');
        throw new Error(
          `Connected endpoint is not compatible with this extension's Twenty GraphQL schema (${lastSchemaError || 'schema mismatch'}).`
        );
      }

      if (lastOtherError) {
        throw new Error(`Connection test failed: ${lastOtherError}`);
      }

      return false;
    } catch (error) {
      console.error('[Twenty] Connection test error:', error);
      // Re-throw to preserve error details
      throw error;
    }
  }

  // Search for records by name
  async searchRecords(
    query: string,
    type: 'person' | 'company'
  ): Promise<Array<{ id: string; name: string; subtitle?: string; type: 'person' | 'company' }>> {
    if (type === 'person') {
      const result = await this.graphqlRequest<PeopleQueryResult>(SEARCH_PEOPLE, {
        filter: {
          or: [
            { name: { firstName: { ilike: `%${query}%` } } },
            { name: { lastName: { ilike: `%${query}%` } } },
          ],
        },
      });

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }

      return (result.data?.people.edges || []).map((edge) => ({
        id: edge.node.id,
        name: `${edge.node.name.firstName} ${edge.node.name.lastName}`,
        subtitle: edge.node.jobTitle || edge.node.company?.name || undefined,
        type: 'person' as const,
      }));
    } else {
      const result = await this.graphqlRequest<CompaniesQueryResult>(SEARCH_COMPANIES, {
        filter: {
          name: { ilike: `%${query}%` },
        },
      });

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }

      return (result.data?.companies.edges || []).map((edge) => ({
        id: edge.node.id,
        name: edge.node.name,
        subtitle: edge.node.domainName?.primaryLinkUrl || undefined,
        type: 'company' as const,
      }));
    }
  }

  // Update existing record with LinkedIn data
  async updateRecordWithLinkedInData(
    id: string,
    type: 'person' | 'company',
    data: LinkedInProfileData | LinkedInCompanyData
  ): Promise<void> {
    if (type === 'person' && data.type === 'person') {
      const personData = data as LinkedInProfileData;

      // Find or create company if present
      let companyId: string | undefined;
      if (personData.currentCompany) {
        try {
          const companyResult = await this.findOrCreateCompany(personData.currentCompany);
          companyId = companyResult.id;
        } catch (error) {
          console.error('Error finding/creating company:', error);
        }
      }

      // Try to upload profile image to Twenty storage
      let avatarUrl = isHttpUrl(personData.profileImageUrl) ? personData.profileImageUrl : undefined;
      if (personData.profileImageUrl) {
        try {
          const uploadedUrl = await this.uploadImageViaGraphQL(
            personData.profileImageUrl,
            `${personData.firstName}-${personData.lastName}-profile.jpg`
          );
          if (uploadedUrl) {
            avatarUrl = uploadedUrl;
            console.log('[Twenty] Profile image uploaded for update:', avatarUrl);
          }
        } catch (error) {
          console.error('[Twenty] Error uploading profile image:', error);
        }
      }

      const result = await this.graphqlRequest<{ updatePerson: { id: string } }>(
        UPDATE_PERSON,
        {
          id,
          input: {
            name: {
              firstName: personData.firstName,
              lastName: personData.lastName,
            },
            linkedinLink: {
              primaryLinkUrl: personData.linkedinUrl,
              primaryLinkLabel: 'LinkedIn',
            },
            jobTitle: personData.headline || undefined,
            avatarUrl: avatarUrl,
            city: personData.location || undefined,
            companyId: companyId,
          },
        }
      );

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }
    } else if (type === 'company' && data.type === 'company') {
      const companyData = data as LinkedInCompanyData;

      const result = await this.graphqlRequest<{ updateCompany: { id: string } }>(
        UPDATE_COMPANY,
        {
          id,
          input: {
            name: companyData.name,
            linkedinLink: {
              primaryLinkUrl: companyData.linkedinUrl,
              primaryLinkLabel: 'LinkedIn',
            },
            domainName: companyData.website
              ? {
                primaryLinkUrl: companyData.website,
                primaryLinkLabel: 'Website',
              }
              : undefined,
            employees: companyData.employeeCount
              ? this.parseEmployeeCount(companyData.employeeCount)
              : undefined,
          },
        }
      );

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }
    }
  }

  private normalizeLinkedInUrl(url: string): string {
    // Extract the profile/company identifier from various LinkedIn URL formats
    const match = url.match(/linkedin\.com\/(in|company)\/([^/?]+)/);
    return match ? match[2] : url;
  }

  private parseEmployeeCount(countStr: string): number | undefined {
    // Parse employee count strings like "1,001-5,000 employees"
    const match = countStr.match(/(\d+(?:,\d+)?)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
    return undefined;
  }
}

// Helper to extract token from Twenty's tokenPair cookie
export function extractTokenFromCookie(
  cookieValue: string
): string | null {
  const isLikelyJwt = (value: string): boolean =>
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);

  const now = Date.now();
  const expirySkewMs = 30 * 1000;

  const normalizeTokenValue = (value: string): string => {
    const trimmed = value.trim().replace(/^"+|"+$/g, '');
    return trimmed.startsWith('Bearer ') ? trimmed.slice(7).trim() : trimmed;
  };

  const tryDecode = (value: string): string => {
    let current = value;
    for (let i = 0; i < 2; i += 1) {
      try {
        const decoded = decodeURIComponent(current);
        if (decoded === current) {
          break;
        }
        current = decoded;
      } catch {
        break;
      }
    }
    return current;
  };

  type TokenCandidate = {
    source: 'known' | 'discovered';
    path: string;
    value: string;
    expiresAtMs?: number;
    score: number;
  };

  const parseExpiryDate = (rawValue: unknown): number | undefined => {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return undefined;
    }

    const parsed = Date.parse(rawValue);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const parseJwtExp = (token: string): number | undefined => {
    if (!isLikelyJwt(token)) {
      return undefined;
    }

    try {
      const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, '=');
      const payloadRaw = atob(padded);
      const payload = JSON.parse(payloadRaw) as { exp?: unknown };
      if (typeof payload.exp !== 'number') {
        return undefined;
      }
      return payload.exp * 1000;
    } catch {
      return undefined;
    }
  };

  const isExpired = (candidate: Pick<TokenCandidate, 'expiresAtMs' | 'value'>): boolean => {
    const expiry = candidate.expiresAtMs ?? parseJwtExp(candidate.value);
    if (!expiry) return false;
    return expiry <= now + expirySkewMs;
  };

  const scoreCandidate = (
    candidate: Omit<TokenCandidate, 'score'>,
    baseScore = 0
  ): number => {
    const path = candidate.path.toLowerCase();
    let score = baseScore;

    if (path.includes('accessorworkspaceagnostictoken')) score += 220;
    if (path.includes('workspaceaccesstoken')) score += 180;
    if (path.includes('accesstoken')) score += 160;
    if (path.includes('access')) score += 70;
    if (path.endsWith('.token') || path === 'token') score += 30;

    if (path.includes('refresh')) score -= 260;
    if (path.includes('csrf') || path.includes('session')) score -= 140;

    if (isLikelyJwt(candidate.value)) {
      score += 45;
    } else if (candidate.value.length >= 24) {
      score += 10;
    } else {
      score -= 35;
    }

    if (isExpired(candidate)) {
      score -= 500;
    } else {
      score += 35;
    }

    return score;
  };

  const findTokenCandidates = (input: unknown): TokenCandidate[] => {
    if (!input) {
      return [];
    }

    const candidates: Array<Omit<TokenCandidate, 'score'>> = [];
    const stack: Array<{ value: unknown; path: string }> = [{ value: input, path: '' }];

    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) {
        continue;
      }

      if (typeof entry.value === 'string') {
        const normalized = normalizeTokenValue(entry.value);
        if (normalized) {
          candidates.push({
            source: 'discovered',
            path: entry.path,
            value: normalized,
          });
        }
        continue;
      }

      if (!entry.value || typeof entry.value !== 'object') {
        continue;
      }

      for (const [key, value] of Object.entries(entry.value as Record<string, unknown>)) {
        const nextPath = entry.path ? `${entry.path}.${key}` : key;
        if (typeof value === 'string') {
          const normalized = normalizeTokenValue(value);
          if (normalized && key.toLowerCase().includes('token')) {
            const parent = entry.value as Record<string, unknown>;
            candidates.push({
              source: 'discovered',
              path: nextPath,
              value: normalized,
              expiresAtMs: parseExpiryDate(parent.expiresAt),
            });
          }
        } else if (value && typeof value === 'object') {
          stack.push({ value, path: nextPath });
        }
      }
    }

    return candidates.map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate),
    }));
  };

  const normalizedCookie = tryDecode(cookieValue).trim();
  if (!normalizedCookie) {
    return null;
  }

  // Sometimes cookie value is directly a JWT token.
  const directToken = normalizeTokenValue(normalizedCookie);
  if (isLikelyJwt(directToken) && !isExpired({ value: directToken })) {
    return directToken;
  }

  try {
    const tokenPair = JSON.parse(normalizedCookie) as TwentyTokenPair & Record<string, unknown>;

    const knownCandidates: TokenCandidate[] = [];
    const pushKnown = (
      path: string,
      rawToken: unknown,
      rawExpiry: unknown,
      baseScore: number
    ) => {
      if (typeof rawToken !== 'string') return;
      const normalized = normalizeTokenValue(rawToken);
      if (!normalized) return;

      const candidateBase = {
        source: 'known' as const,
        path,
        value: normalized,
        expiresAtMs: parseExpiryDate(rawExpiry),
      };
      knownCandidates.push({
        ...candidateBase,
        score: scoreCandidate(candidateBase, baseScore),
      });
    };

    pushKnown(
      'accessOrWorkspaceAgnosticToken.token',
      tokenPair.accessOrWorkspaceAgnosticToken?.token,
      tokenPair.accessOrWorkspaceAgnosticToken?.expiresAt,
      600
    );
    pushKnown(
      'workspaceAccessToken.token',
      tokenPair.workspaceAccessToken?.token,
      tokenPair.workspaceAccessToken?.expiresAt,
      560
    );
    pushKnown(
      'accessToken.token',
      tokenPair.accessToken?.token,
      tokenPair.accessToken?.expiresAt,
      520
    );
    pushKnown(
      'accessOrWorkspaceAgnosticToken',
      typeof tokenPair.accessOrWorkspaceAgnosticToken === 'string'
        ? tokenPair.accessOrWorkspaceAgnosticToken
        : undefined,
      undefined,
      500
    );
    pushKnown(
      'workspaceAccessToken',
      typeof tokenPair.workspaceAccessToken === 'string'
        ? tokenPair.workspaceAccessToken
        : undefined,
      undefined,
      470
    );
    pushKnown(
      'accessToken',
      typeof tokenPair.accessToken === 'string' ? tokenPair.accessToken : undefined,
      undefined,
      440
    );
    pushKnown('token', typeof tokenPair.token === 'string' ? tokenPair.token : undefined, undefined, 300);

    // Fallback for unknown tokenPair variants.
    const discovered = findTokenCandidates(tokenPair);
    const combined = [...knownCandidates, ...discovered];
    if (combined.length === 0) {
      return null;
    }

    // Deduplicate by token value, keeping the best-scored variant.
    const deduped = new Map<string, TokenCandidate>();
    for (const candidate of combined) {
      const existing = deduped.get(candidate.value);
      if (!existing || candidate.score > existing.score) {
        deduped.set(candidate.value, candidate);
      }
    }

    const sorted = Array.from(deduped.values()).sort((a, b) => b.score - a.score);
    const nonExpired = sorted.filter((candidate) => !isExpired(candidate));

    if (nonExpired.length > 0 && nonExpired[0].score > 0) {
      return nonExpired[0].value;
    }

    const best = sorted[0];
    if (!best || best.score <= 0) {
      return null;
    }
    return best.value;
  } catch {
    return null;
  }
}

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

const FIND_COMPANY_BY_DOMAIN = `
  query FindCompanyByDomain($filter: CompanyFilterInput) {
    companies(filter: $filter, first: 1) {
      edges {
        node {
          id
          name
          linkedinLink {
            primaryLinkUrl
          }
          domainName {
            primaryLinkUrl
            primaryLinkLabel
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
        console.error('[Twenty] GraphQL errors:', result.errors);
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
    if (!this.token) {
      throw new Error('No authentication token set');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ query, variables }),
      });
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

  async findCompanyByDomain(
    domain: string
  ): Promise<CompaniesQueryResult['companies']['edges'][0]['node'] | null> {
    // Normalize domain (remove protocol, www, etc.)
    const normalizedDomain = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '');

    // Search for company by domain (case-insensitive)
    const result = await this.graphqlRequest<CompaniesQueryResult>(
      FIND_COMPANY_BY_DOMAIN,
      {
        filter: {
          domainName: {
            primaryLinkUrl: {
              ilike: `%${normalizedDomain}%`,
            },
          },
        },
      }
    );

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    const companies = result.data?.companies.edges || [];
    
    // Try to find exact match by comparing normalized domains
    const exactMatch = companies.find((c) => {
      const companyDomain = c.node.domainName?.primaryLinkUrl;
      if (!companyDomain) return false;
      const normalizedCompanyDomain = companyDomain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
      return normalizedCompanyDomain === normalizedDomain;
    });

    if (exactMatch) {
      return exactMatch.node;
    }

    // Return first match if no exact match
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
    let avatarUrl = data.profileImageUrl || '';
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
          linkedinLink: data.linkedinUrl
            ? {
                primaryLinkUrl: data.linkedinUrl,
                primaryLinkLabel: 'LinkedIn',
              }
            : undefined,
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
      // Simple query to test if the connection works
      const result = await this.graphqlRequest<{ currentWorkspace: { id: string } }>(
        `query { currentWorkspace { id } }`
      );

      if (result.errors?.length) {
        const errorMessage = result.errors[0].message;
        console.error('[Twenty] Connection test GraphQL errors:', errorMessage);
        // If it's an authentication error, throw it so it can be caught upstream
        if (errorMessage.includes('Unauthorized') || errorMessage.includes('authentication') || errorMessage.includes('token')) {
          throw new Error('Authentication failed. Please log in to your Twenty instance.');
        }
        return false;
      }

      return !!result.data?.currentWorkspace;
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
      let avatarUrl = personData.profileImageUrl || undefined;
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
  try {
    const tokenPair: TwentyTokenPair = JSON.parse(cookieValue);
    return tokenPair.accessOrWorkspaceAgnosticToken?.token || null;
  } catch {
    return null;
  }
}

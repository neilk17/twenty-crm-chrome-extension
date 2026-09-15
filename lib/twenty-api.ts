import type {
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

// Twenty workspaces differ in which standard fields exist: `employees` was
// dropped from Company, and `city` from Person, in later versions, and admins
// can remove fields too. Sending one the workspace lacks fails the whole
// mutation ("Object company doesn't have any \"employees\" field"), so optional
// fields are included only after the schema says they exist.
type OptionalInputType =
  | 'CompanyCreateInput'
  | 'CompanyUpdateInput'
  | 'PersonCreateInput'
  | 'PersonUpdateInput';

const INPUT_FIELDS_QUERY = `
  query ExtensionInputFields($name: String!) {
    __type(name: $name) {
      inputFields {
        name
      }
    }
  }
`;

export const NO_API_KEY_MESSAGE =
  'No API key configured. Add your Twenty API key in the extension settings.';

export class TwentyApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private supportedInputFields = new Map<OptionalInputType, Set<string>>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string | null) {
    this.token = token;
  }

  // Resolves once per input type per client, then stays cached.
  private async getSupportedInputFields(
    typeName: OptionalInputType
  ): Promise<Set<string>> {
    const cached = this.supportedInputFields.get(typeName);
    if (cached) {
      return cached;
    }

    let fields = new Set<string>();
    try {
      const result = await this.graphqlRequest<{
        __type: { inputFields: Array<{ name: string }> | null } | null;
      }>(INPUT_FIELDS_QUERY, { name: typeName });

      const inputFields = result.data?.__type?.inputFields;
      if (inputFields) {
        fields = new Set(inputFields.map((field) => field.name));
      } else {
        // Introspection disabled or type renamed: assume the optional fields are
        // absent rather than failing every capture on an unknown field.
        console.warn('[Twenty] Could not introspect', typeName, '- omitting optional fields');
      }
    } catch (error) {
      if (isTwentyAuthErrorMessage(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
      console.warn('[Twenty] Schema introspection failed for', typeName, error);
    }

    this.supportedInputFields.set(typeName, fields);
    return fields;
  }

  // Drops any optional field this workspace does not expose.
  private async pickSupportedFields<T extends Record<string, unknown>>(
    typeName: OptionalInputType,
    optionalValues: T
  ): Promise<Partial<T>> {
    const entries = Object.entries(optionalValues).filter(
      ([, value]) => value !== undefined
    );
    if (entries.length === 0) {
      return {};
    }

    const supported = await this.getSupportedInputFields(typeName);
    const picked: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      if (supported.has(key)) {
        picked[key] = value;
      } else {
        console.info(`[Twenty] Skipping "${key}": not present on ${typeName} in this workspace`);
      }
    }
    return picked as Partial<T>;
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
    if (!this.token) {
      throw new Error(NO_API_KEY_MESSAGE);
    }

    let response: Response;
    try {
      // Bearer-only. Twenty's session cookie is httpOnly and its CSRF guard rejects
      // cookie-authenticated requests from extension origins, so cookies are never sent.
      response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        credentials: 'omit',
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
        errorMessage = 'Authentication failed. Twenty rejected the API key.';
      } else if (response.status === 404) {
        errorMessage = `GraphQL endpoint not found at ${this.baseUrl}/graphql. Please check your URL.`;
      } else if (response.status >= 500) {
        errorMessage = 'Server error. Please try again later.';
      }
      throw new Error(errorMessage);
    }

    return response.json();
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
        ...(await this.pickSupportedFields('PersonCreateInput', {
          city: data.location || undefined,
        })),
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
          ...(await this.pickSupportedFields('CompanyCreateInput', {
            employees: data.employeeCount
              ? this.parseEmployeeCount(data.employeeCount)
              : undefined,
          })),
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
          name: 'people',
          query: `query { people(first: 1) { edges { node { id } } } }`,
          isValid: (data) => Array.isArray((data as { people?: { edges?: unknown[] } })?.people?.edges),
        },
        // Last on purpose: API keys have no user, so this only helps on older servers.
        {
          name: 'currentUser',
          query: `query { currentUser { id } }`,
          isValid: (data) => !!(data as { currentUser?: { id?: string } })?.currentUser?.id,
        },
      ];

      let sawSchemaCompatibilityError = false;
      let lastSchemaError: string | null = null;
      let lastOtherError: string | null = null;

      for (const probe of probes) {
        const result = await this.graphqlRequest<unknown>(probe.query);

        if (result.errors?.length) {
          const errorMessage = result.errors[0].message;

          if (isTwentyAuthErrorMessage(errorMessage)) {
            throw new Error('Authentication failed. Twenty rejected the API key.');
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (isTwentyAuthErrorMessage(errorMessage)) {
        console.info('[Twenty] Connection test rejected the API key.');
      } else {
        console.error('[Twenty] Connection test error:', error);
      }
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
            ...(await this.pickSupportedFields('PersonUpdateInput', {
              city: personData.location || undefined,
            })),
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
            ...(await this.pickSupportedFields('CompanyUpdateInput', {
              employees: companyData.employeeCount
                ? this.parseEmployeeCount(companyData.employeeCount)
                : undefined,
            })),
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

// Twenty API keys are JWTs. Accept a pasted "Bearer <key>" too and reject anything with whitespace.
export function normalizeApiKey(value: string): string | null {
  const trimmed = value.trim().replace(/^Bearer\s+/i, '');
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function isTwentyAuthErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('unauthorized')
    || normalized.includes('authentication')
    || normalized.includes('forbidden')
    || normalized.includes('invalid token')
    || normalized.includes('token')
    || normalized.includes('jwt')
    || normalized.includes('access denied')
    || normalized.includes('expired')
    || normalized.includes('session')
    || normalized.includes('api key')
    || normalized.includes('not logged in');
}

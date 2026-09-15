import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwentyApiClient, isTwentyAuthErrorMessage, normalizeApiKey } from '../twenty-api';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TwentyApiClient auth', () => {
  it('sends the API key as a bearer token and never relies on cookies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ data: { currentWorkspace: { id: 'ws-1' } } }),
    );

    const client = new TwentyApiClient('https://crm.example.com/');
    client.setToken('api-key-jwt');

    await expect(client.testConnection()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://crm.example.com/graphql');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer api-key-jwt');
    // Regression: Twenty's httpOnly session cookie cannot authenticate extension
    // requests (CSRF origin check), so the client must not send or retry with cookies.
    expect(init.credentials).toBe('omit');
  });

  it('refuses to call the API without a key instead of falling back to a cookie session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const client = new TwentyApiClient('https://crm.example.com');

    await expect(client.testConnection()).rejects.toThrow(/No API key configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a rejected key as an auth error rather than a schema mismatch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        errors: [{ message: 'Invalid token type', extensions: { code: 'FORBIDDEN' } }],
      }),
    );

    const client = new TwentyApiClient('https://crm.example.com');
    client.setToken('revoked-key');

    await expect(client.testConnection()).rejects.toThrow(/rejected the API key/);
  });

  it('does not treat 401/403 as a reason to retry without the bearer token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ statusCode: 401 }, 401));

    const client = new TwentyApiClient('https://crm.example.com');
    client.setToken('expired-key');

    await expect(client.testConnection()).rejects.toThrow(/Authentication failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeApiKey', () => {
  it('trims whitespace and a pasted Bearer prefix', () => {
    expect(normalizeApiKey('  Bearer abc.def.ghi \n')).toBe('abc.def.ghi');
  });

  it('rejects empty input and keys containing whitespace', () => {
    expect(normalizeApiKey('   ')).toBeNull();
    expect(normalizeApiKey('abc def')).toBeNull();
  });
});

describe('isTwentyAuthErrorMessage', () => {
  it('recognises the messages the extension maps to a rejected key', () => {
    expect(isTwentyAuthErrorMessage('Twenty rejected the API key.')).toBe(true);
    expect(isTwentyAuthErrorMessage('Cannot query field "people" on type "Query".')).toBe(false);
  });
});

describe('schema-dependent optional fields', () => {
  const introspection = (fields: string[]) => ({
    data: { __type: { inputFields: fields.map((name) => ({ name })) } },
  });

  const lastMutationInput = (fetchMock: ReturnType<typeof vi.spyOn>) => {
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const mutation = calls
      .map(([, init]) => JSON.parse(init.body as string))
      .find((body) => String(body.query).includes('mutation'));
    return mutation.variables.input;
  };

  it('omits employees when the workspace has no such field on Company', async () => {
    // Regression: sending a field the workspace lacks fails the whole mutation with
    // 'Object company doesn't have any "employees" field'.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (String(body.query).includes('__type')) {
        return jsonResponse(introspection(['name', 'domainName', 'linkedinLink']));
      }
      return jsonResponse({ data: { createCompany: { id: 'c-1', name: 'Acme' } } });
    });

    const client = new TwentyApiClient('https://crm.example.com');
    client.setToken('api-key-jwt');

    await client.createCompany({
      type: 'company',
      name: 'Acme',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
      employeeCount: '1,001-5,000 employees',
    } as never);

    expect(lastMutationInput(fetchMock)).not.toHaveProperty('employees');
  });

  it('still sends employees when the workspace does expose the field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (String(body.query).includes('__type')) {
        return jsonResponse(introspection(['name', 'domainName', 'employees']));
      }
      return jsonResponse({ data: { createCompany: { id: 'c-1', name: 'Acme' } } });
    });

    const client = new TwentyApiClient('https://crm.example.com');
    client.setToken('api-key-jwt');

    await client.createCompany({
      type: 'company',
      name: 'Acme',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
      employeeCount: '1,001-5,000 employees',
    } as never);

    expect(lastMutationInput(fetchMock)).toMatchObject({ employees: 1001 });
  });

  it('omits optional fields when introspection is unavailable rather than failing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (String(body.query).includes('__type')) {
        return jsonResponse({ data: { __type: null } });
      }
      return jsonResponse({ data: { createCompany: { id: 'c-1', name: 'Acme' } } });
    });

    const client = new TwentyApiClient('https://crm.example.com');
    client.setToken('api-key-jwt');

    await expect(
      client.createCompany({
        type: 'company',
        name: 'Acme',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
        employeeCount: '500 employees',
      } as never),
    ).resolves.toMatchObject({ id: 'c-1' });

    expect(lastMutationInput(fetchMock)).not.toHaveProperty('employees');
  });

  it('introspects each input type once and reuses the result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (String(body.query).includes('__type')) {
        return jsonResponse(introspection(['name', 'employees']));
      }
      return jsonResponse({ data: { createCompany: { id: 'c-1', name: 'Acme' } } });
    });

    const client = new TwentyApiClient('https://crm.example.com');
    client.setToken('api-key-jwt');

    const company = {
      type: 'company',
      name: 'Acme',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
      employeeCount: '10 employees',
    } as never;
    await client.createCompany(company);
    await client.createCompany(company);

    const introspectionCalls = (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
      ([, init]) => String(JSON.parse(init.body as string).query).includes('__type'),
    );
    expect(introspectionCalls).toHaveLength(1);
  });
});

describe('normalizeApiKey whitespace handling', () => {
  it('strips a Bearer prefix with any amount of following whitespace', () => {
    expect(normalizeApiKey('Bearer    abc.def.ghi')).toBe('abc.def.ghi');
  });
});

/**
 * Utility functions for extracting and normalizing domains from URLs
 */

/**
 * Extracts the root domain from a URL
 * Examples:
 * - https://www.example.com/about -> example.com
 * - https://subdomain.example.com/path -> example.com
 * - http://example.co.uk -> example.co.uk
 * - https://example.com:8080/path?query=1 -> example.com
 */
export function extractDomainFromUrl(url: string): string | null {
  try {
    // Handle cases where URL might not have protocol
    let urlToParse = url;
    if (!urlToParse.startsWith('http://') && !urlToParse.startsWith('https://')) {
      urlToParse = 'https://' + urlToParse;
    }

    const urlObj = new URL(urlToParse);
    const hostname = urlObj.hostname;

    // Remove port if present
    const hostnameWithoutPort = hostname.split(':')[0];

    // Split by dots
    const parts = hostnameWithoutPort.split('.');

    // Handle special cases for two-part TLDs (e.g., .co.uk, .com.au)
    const twoPartTlds = [
      'co.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'com.mx',
      'com.ar', 'com.co', 'com.sg', 'com.hk', 'com.tw', 'com.tr',
      'com.vn', 'com.ph', 'com.my', 'com.id', 'com.th', 'com.kr',
      'co.jp', 'co.in', 'com.cn', 'com.ru', 'com.ua', 'com.pl',
      'com.cz', 'com.ro', 'com.gr', 'com.pt', 'com.es', 'com.it',
      'com.fr', 'com.de', 'com.nl', 'com.be', 'com.ch', 'com.at',
      'com.se', 'com.no', 'com.dk', 'com.fi', 'com.ie', 'com.uk'
    ];

    // If we have at least 3 parts, check if last two form a two-part TLD
    if (parts.length >= 3) {
      const lastTwo = parts.slice(-2).join('.');
      if (twoPartTlds.includes(lastTwo.toLowerCase())) {
        // Return domain with two-part TLD (e.g., example.co.uk)
        return parts.slice(-3).join('.');
      }
    }

    // For most cases, return last two parts (domain.tld)
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }

    // Fallback: return the hostname as-is if we can't parse it
    return hostnameWithoutPort;
  } catch (error) {
    console.error('Error extracting domain from URL:', error);
    return null;
  }
}

/**
 * Normalizes a domain to a standard format
 * - Converts to lowercase
 * - Removes www. prefix
 * - Removes trailing slashes
 */
export function normalizeDomain(domain: string): string {
  let normalized = domain.toLowerCase().trim();

  // Remove protocol if present
  normalized = normalized.replace(/^https?:\/\//, '');

  // Remove www. prefix
  normalized = normalized.replace(/^www\./, '');

  // Remove path, query, and fragment
  normalized = normalized.split('/')[0];
  normalized = normalized.split('?')[0];
  normalized = normalized.split('#')[0];

  // Remove port
  normalized = normalized.split(':')[0];

  return normalized;
}

/**
 * Extracts and normalizes domain from URL in one step
 */
export function getNormalizedDomain(url: string): string | null {
  const domain = extractDomainFromUrl(url);
  if (!domain) {
    return null;
  }
  return normalizeDomain(domain);
}

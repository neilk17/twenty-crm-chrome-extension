import type { LinkedInProfileData, LinkedInCompanyData, LinkedInData } from '../types';

// Detect page type from URL
export function getLinkedInPageType(url: string): 'person' | 'company' | null {
  if (url.includes('linkedin.com/in/')) {
    return 'person';
  }
  if (url.includes('linkedin.com/company/')) {
    return 'company';
  }
  return null;
}

// Extract LinkedIn profile identifier from URL
export function getLinkedInIdentifier(url: string): string | null {
  const personMatch = url.match(/linkedin\.com\/in\/([^/?]+)/);
  if (personMatch) return personMatch[1];

  const companyMatch = url.match(/linkedin\.com\/company\/([^/?]+)/);
  if (companyMatch) return companyMatch[1];

  return null;
}

function isHttpImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getCleanText(value?: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function readMetaContent(selector: string): string {
  const element = document.querySelector(selector);
  return getCleanText(element?.getAttribute('content'));
}

function cleanCompanyName(raw: string): string {
  let name = getCleanText(raw);
  if (!name) return '';

  name = name.replace(/\s*[|]\s*LinkedIn.*$/i, '').trim();
  name = name.replace(/\s*-\s*LinkedIn.*$/i, '').trim();
  name = name.replace(/^LinkedIn:\s*/i, '').trim();

  if (name.includes(':')) {
    const [firstPart, secondPart] = name.split(':', 2);
    if (/(overview|employees|people|about|jobs|insights)/i.test(secondPart || '')) {
      name = firstPart.trim();
    }
  }

  return name;
}

function getCompanyNameFromLinkedInUrl(url: string): string {
  const companyMatch = url.match(/linkedin\.com\/company\/([^/?]+)/i);
  if (!companyMatch) return '';

  try {
    const slug = decodeURIComponent(companyMatch[1]);
    return getCleanText(slug.replace(/[-_]+/g, ' '));
  } catch {
    return getCleanText(companyMatch[1].replace(/[-_]+/g, ' '));
  }
}

function readOrganizationJsonLd(): {
  name?: string;
  description?: string;
  logoUrl?: string;
  website?: string;
} {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));

  for (const script of scripts) {
    const raw = script.textContent;
    if (!raw) continue;

    try {
      const json = JSON.parse(raw) as unknown;
      const nodes: unknown[] = Array.isArray(json) ? json : [json];

      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;

        const candidate = node as Record<string, unknown>;
        const type = candidate['@type'];
        const typeValues = Array.isArray(type) ? type : [type];
        const isOrganization = typeValues.some((v) =>
          typeof v === 'string' && /(organization|corporation|company)/i.test(v)
        );

        if (!isOrganization) continue;

        const logoValue = candidate.logo;
        const logoUrl =
          typeof logoValue === 'string'
            ? logoValue
            : logoValue && typeof logoValue === 'object' && typeof (logoValue as Record<string, unknown>).url === 'string'
              ? ((logoValue as Record<string, unknown>).url as string)
              : undefined;

        const sameAs = candidate.sameAs;
        let website: string | undefined;
        if (Array.isArray(sameAs)) {
          const external = sameAs.find(
            (v) => typeof v === 'string' && /^https?:\/\//.test(v) && !v.includes('linkedin.com')
          );
          website = typeof external === 'string' ? external : undefined;
        }

        return {
          name: typeof candidate.name === 'string' ? cleanCompanyName(candidate.name) : undefined,
          description: typeof candidate.description === 'string' ? getCleanText(candidate.description) : undefined,
          logoUrl,
          website,
        };
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return {};
}

function resolveCompanyName(linkedinUrl: string): string {
  const selectorCandidates = [
    'h1.org-top-card-summary__title',
    'h1[data-test-id*="entity"]',
    'h1[data-test-id*="company"]',
    'section h1',
    'main h1',
    'h1[title]',
  ];

  for (const selector of selectorCandidates) {
    const text = cleanCompanyName(document.querySelector(selector)?.textContent || '');
    if (text) return text;
  }

  const ogTitle = cleanCompanyName(readMetaContent('meta[property="og:title"]'));
  if (ogTitle) return ogTitle;

  const twitterTitle = cleanCompanyName(readMetaContent('meta[name="twitter:title"]'));
  if (twitterTitle) return twitterTitle;

  const jsonLd = readOrganizationJsonLd();
  if (jsonLd.name) return cleanCompanyName(jsonLd.name);

  const titleName = cleanCompanyName(document.title);
  if (titleName) return titleName;

  return getCompanyNameFromLinkedInUrl(linkedinUrl);
}

function resolveCompanyEmployeeCount(): string {
  const employeePattern =
    /\b\d[\d,.+\s]*\s*(employee(s)?|employé(e)?s?|empleado(s)?|mitarbeiter(innen)?|collaborateur(s)?)\b/i;

  const infoItems = document.querySelectorAll('.org-top-card-summary-info-list__info-item');
  for (const el of infoItems) {
    const text = getCleanText(el.textContent);
    if (employeePattern.test(text)) return text;
  }

  // Sales Navigator and newer LinkedIn layouts often render plain text without stable classes.
  const allTextNodes = document.querySelectorAll('span, div, li, p');
  for (const node of allTextNodes) {
    const text = getCleanText(node.textContent);
    if (employeePattern.test(text)) return text;
  }

  return '';
}

function resolveCompanyWebsite(jsonLdWebsite?: string): string {
  const websiteElement =
    document.querySelector('a[data-control-name="top_card_link_website"]') ||
    document.querySelector('.link-without-visited-state.org-top-card-primary-actions__action') ||
    document.querySelector('a[data-test-id*="website"]');

  const href = websiteElement?.getAttribute('href') || '';
  if (href && isHttpImageUrl(href)) return href;

  if (jsonLdWebsite && isHttpImageUrl(jsonLdWebsite)) return jsonLdWebsite;

  return '';
}

/**
 * Walk up from an anchor element looking for the first sibling <p> with
 * headline-like text (≥10 chars, not pronouns / degree badges / follower counts).
 */
function findNearbyHeadline(anchor: Element): string {
  let el: Element | null = anchor;
  for (let depth = 0; depth < 10 && el; depth++) {
    const parent: Element | null = el.parentElement;
    if (!parent || parent.tagName === 'MAIN' || parent.tagName === 'BODY') break;

    const children = parent.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Element;
      if (child.tagName !== 'P' || child.contains(anchor)) continue;
      const text = child.textContent?.trim() || '';
      if (text.length < 10) continue;
      if (text.startsWith('·')) continue;
      if (/^(he|she|they|ze)\//i.test(text)) continue;
      if (/mutual connection/i.test(text)) continue;
      if (/\bfollower/i.test(text)) continue;
      return text;
    }

    el = parent;
  }
  return '';
}

/**
 * Locate the location string by finding the "Contact info" link and reading
 * the first sibling <p> in the same container.
 */
function findLocationNearContactInfo(): string {
  for (const link of document.querySelectorAll('a')) {
    if (link.textContent?.trim() !== 'Contact info') continue;
    const container = link.closest('p')?.parentElement;
    if (!container) continue;
    const firstP = container.querySelector('p');
    const text = firstP?.textContent?.trim() || '';
    if (text && text !== 'Contact info' && !text.startsWith('·')) return text;
  }
  return '';
}

// Scrape person profile data from LinkedIn page
export function scrapePersonProfile(): LinkedInProfileData | null {
  try {
    const linkedinUrl = window.location.href.split('?')[0];

    const nameElement =
      document.querySelector('[data-view-name="profile-top-card-verified-badge"] h2') ||
      document.querySelector('h1.text-heading-xlarge') ||
      document.querySelector('h1.inline.t-24') ||
      document.querySelector('h1.t-24.v-align-middle') ||
      document.querySelector('.pv-top-card h1') ||
      document.querySelector('h1[class*="break-words"]') ||
      document.querySelector('main h2');

    if (!nameElement) {
      console.warn('Could not find name element - tried multiple selectors');
      return null;
    }

    const fullName = nameElement.textContent?.trim() || '';
    console.log('Scraped name:', fullName);
    const nameParts = parseFullName(fullName);

    const headlineElement =
      document.querySelector('div[data-generated-suggestion-target]') ||
      document.querySelector('div.text-body-medium.break-words');
    let headline = headlineElement?.textContent?.trim() || '';
    if (!headline) {
      headline = findNearbyHeadline(nameElement);
    }
    console.log('Scraped headline:', headline);

    // Get current company info
    const companyData = scrapeCurrentCompanyFromProfile();
    const currentCompany = companyData?.name || extractCompanyFromHeadline(headline);
    console.log('Scraped company data:', companyData);
    console.log('Current company:', currentCompany);

    // Get profile image - try to get high quality version
    const profileImageUrl = scrapeProfileImage();

    const locationElement =
      document.querySelector('span.text-body-small.inline.t-black--light.break-words') ||
      document.querySelector('.text-body-small.inline.t-black--light.break-words') ||
      document.querySelector('.pv-top-card--list-bullet li:last-child');
    let location = locationElement?.textContent?.trim() || '';
    if (!location) {
      location = findLocationNearContactInfo();
    }
    console.log('Scraped location:', location);

    const result = {
      type: 'person' as const,
      linkedinUrl,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      headline,
      currentCompany,
      currentCompanyLinkedInUrl: companyData?.linkedinUrl,
      profileImageUrl: profileImageUrl || undefined,
      location: location || undefined,
    };

    console.log('Scraped profile data:', {
      fullName,
      firstName: result.firstName,
      lastName: result.lastName,
      headline: result.headline,
    });

    return result;
  } catch (error) {
    console.error('Error scraping person profile:', error);
    return null;
  }
}

// Scrape profile image
function scrapeProfileImage(): string {
  // Try multiple selectors - LinkedIn changes DOM frequently
  const selectors = [
    '.pv-top-card-profile-picture__container img',  // New format with button wrapper
    '.pv-top-card-profile-picture__image',          // Old format
    'img.profile-photo-edit__preview',
    '.pv-top-card__photo img',
    'button[aria-label*="image"] img',              // Button with image label
    '.EntityPhoto-circle-9 img',                    // Entity photo class
    'img[title]',                                   // Fallback: img with title (usually name)
  ];

  for (const selector of selectors) {
    const img = document.querySelector(selector) as HTMLImageElement;
    const candidateUrl = img?.currentSrc || img?.src || '';
    if (
      candidateUrl &&
      isHttpImageUrl(candidateUrl) &&
      !candidateUrl.includes('ghost') &&
      candidateUrl.includes('profile')
    ) {
      // Use the URL as-is - LinkedIn URLs have signed params that break if modified
      console.log('Scraped profile image:', candidateUrl);
      return candidateUrl;
    }
  }

  return '';
}

// Scrape company info from current profile page
function scrapeCurrentCompanyFromProfile(): { name: string; linkedinUrl?: string; logoUrl?: string } | null {
  try {
    // Best method: Find button with aria-label containing "Entreprise actuelle" or "Current company"
    // This button contains company name, logo, and links to company page
    const companyButton =
      document.querySelector('button[aria-label*="Entreprise actuelle"]') ||
      document.querySelector('button[aria-label*="Current company"]') ||
      document.querySelector('button[aria-label*="Empresa actual"]') ||  // Spanish
      document.querySelector('button[aria-label*="Aktuelles Unternehmen"]');  // German

    if (companyButton) {
      // Extract company name from aria-label (format: "Entreprise actuelle: CompanyName. ...")
      const ariaLabel = companyButton.getAttribute('aria-label') || '';
      const nameMatch = ariaLabel.match(/:\s*([^.]+)/);
      const name = nameMatch ? nameMatch[1].trim() : '';

      // Get company logo URL
      const logoImg = companyButton.querySelector('img');
      const logoUrl = logoImg?.src || undefined;

      // Try to get company LinkedIn URL from nearby link or page navigation
      // The button itself doesn't have the URL, but we can try to find it elsewhere
      let linkedinUrl: string | undefined;

      if (name) {
        console.log('Found company from button:', { name, logoUrl });
        return { name, linkedinUrl, logoUrl };
      }
    }

    // Fallback: Try to find company link in the experience section or top card
    const companyLink =
      document.querySelector('.pv-text-details__right-panel-item-text a[href*="/company/"]') ||
      document.querySelector('a[data-field="experience_company_logo"]') ||
      document.querySelector('.experience-item a[href*="/company/"]');

    if (companyLink) {
      const href = companyLink.getAttribute('href') || '';
      const match = href.match(/\/company\/([^/?]+)/);
      const linkedinUrl = match ? `https://www.linkedin.com/company/${match[1]}/` : undefined;

      const name = companyLink.textContent?.trim() ||
        companyLink.closest('.pv-text-details__right-panel-item-text')?.textContent?.trim() ||
        '';

      if (name) {
        return { name, linkedinUrl };
      }
    }

    // Last fallback: just get company name without URL
    const companyElement =
      document.querySelector('.pv-text-details__right-panel-item-text') ||
      document.querySelector('[aria-label*="Current company"]');

    if (companyElement) {
      return { name: companyElement.textContent?.trim() || '' };
    }

    return null;
  } catch (error) {
    console.error('Error scraping company from profile:', error);
    return null;
  }
}

// Scrape company page data from LinkedIn
export function scrapeCompanyPage(): LinkedInCompanyData | null {
  try {
    const linkedinUrl = window.location.href.split('?')[0];

    const jsonLd = readOrganizationJsonLd();

    // Company name with resilient fallback chain for Sales Navigator / redesigned pages.
    const name = resolveCompanyName(linkedinUrl);
    if (!name) {
      console.warn('Could not resolve company name from page or metadata');
      return null;
    }

    // Industry
    const industryElement = document.querySelector('.org-top-card-summary-info-list__info-item');
    const industry = getCleanText(industryElement?.textContent);

    // Employee count
    const employeeCount = resolveCompanyEmployeeCount();

    // Website
    const website = resolveCompanyWebsite(jsonLd.website);

    // Logo
    const logoElement = document.querySelector('.org-top-card-primary-content__logo') as HTMLImageElement | null;
    const logoUrl = logoElement?.currentSrc || logoElement?.getAttribute('src') || jsonLd.logoUrl || '';

    // Description/tagline
    const descElement = document.querySelector('.org-top-card-summary__tagline');
    const description = getCleanText(descElement?.textContent) || getCleanText(jsonLd.description);

    return {
      type: 'company',
      linkedinUrl,
      name,
      website: website || undefined,
      industry: industry || undefined,
      employeeCount: employeeCount || undefined,
      logoUrl: logoUrl || undefined,
      description: description || undefined,
    };
  } catch (error) {
    console.error('Error scraping company page:', error);
    return null;
  }
}

// Main scraper function that detects page type and scrapes accordingly
export function scrapeCurrentPage(): LinkedInData | null {
  const pageType = getLinkedInPageType(window.location.href);

  if (pageType === 'person') {
    return scrapePersonProfile();
  }

  if (pageType === 'company') {
    return scrapeCompanyPage();
  }

  return null;
}

// Helper to parse full name into first and last name
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  // Handle cases like "John van der Berg" - take first as firstName, rest as lastName
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');

  return { firstName, lastName };
}

// Try to extract company name from headline like "Software Engineer at Google"
function extractCompanyFromHeadline(headline: string): string {
  // Match various patterns: "at Company", "chez Company" (French), "@ Company", "for Company"
  const patterns = [
    /\bat\s+(.+?)(?:\s*\||$)/i,           // English: "at Company"
    /\bchez\s+(.+?)(?:\s*\||$)/i,         // French: "chez Company"
    /\bbei\s+(.+?)(?:\s*\||$)/i,          // German: "bei Company"
    /\b@\s*(.+?)(?:\s*\||$)/i,            // Symbol: "@ Company" or "@Company"
    /\bfor\s+(.+?)(?:\s*\||$)/i,          // English: "for Company"
    /\bà\s+(.+?)(?:\s*\||$)/i,            // French: "à Company"
    /\ben\s+(.+?)(?:\s*\||$)/i,           // Spanish: "en Company"
  ];

  for (const pattern of patterns) {
    const match = headline.match(pattern);
    if (match) {
      const company = match[1].trim();
      console.log('Extracted company from headline:', company, 'using pattern:', pattern);
      return company;
    }
  }

  return '';
}

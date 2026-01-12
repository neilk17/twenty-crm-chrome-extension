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

// Scrape person profile data from LinkedIn page
export function scrapePersonProfile(): LinkedInProfileData | null {
  try {
    const linkedinUrl = window.location.href.split('?')[0];
    
    // Get name - LinkedIn uses h1 for the profile name with various class combinations
    // Try multiple selectors as LinkedIn frequently changes their DOM
    const nameElement = 
      document.querySelector('h1.text-heading-xlarge') ||  // Old format
      document.querySelector('h1.inline.t-24') ||          // New format (2024+)
      document.querySelector('h1.t-24.v-align-middle') ||  // Another variant
      document.querySelector('.pv-top-card h1') ||         // Fallback: h1 in top card
      document.querySelector('h1[class*="break-words"]');  // Generic fallback
    
    if (!nameElement) {
      console.warn('Could not find name element - tried multiple selectors');
      return null;
    }
    
    const fullName = nameElement.textContent?.trim() || '';
    console.log('Scraped name:', fullName);
    const nameParts = parseFullName(fullName);
    
    // Get headline/title - div with text-body-medium class that has job title
    // Use data-generated-suggestion-target attribute as it's more reliable
    const headlineElement = 
      document.querySelector('div[data-generated-suggestion-target]') ||
      document.querySelector('div.text-body-medium.break-words');
    const headline = headlineElement?.textContent?.trim() || '';
    console.log('Scraped headline:', headline);
    
    // Get current company info
    const companyData = scrapeCurrentCompanyFromProfile();
    const currentCompany = companyData?.name || extractCompanyFromHeadline(headline);
    console.log('Scraped company data:', companyData);
    console.log('Current company:', currentCompany);
    
    // Get profile image - try to get high quality version
    const profileImageUrl = scrapeProfileImage();
    
    // Get location - span with location info
    const locationElement = 
      document.querySelector('span.text-body-small.inline.t-black--light.break-words') ||
      document.querySelector('.text-body-small.inline.t-black--light.break-words') ||
      document.querySelector('.pv-top-card--list-bullet li:last-child');
    const location = locationElement?.textContent?.trim() || '';
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
    if (img?.src && !img.src.includes('ghost') && img.src.includes('profile')) {
      // Use the URL as-is - LinkedIn URLs have signed params that break if modified
      console.log('Scraped profile image:', img.src);
      return img.src;
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
    
    // Company name
    const nameElement = 
      document.querySelector('h1.org-top-card-summary__title') ||
      document.querySelector('.org-top-card-summary-info-list__info-item') ||
      document.querySelector('h1[title]');
    
    if (!nameElement) {
      console.warn('Could not find company name element');
      return null;
    }
    
    const name = nameElement.textContent?.trim() || '';
    
    // Industry
    const industryElement = document.querySelector('.org-top-card-summary-info-list__info-item');
    const industry = industryElement?.textContent?.trim() || '';
    
    // Employee count
    const employeeElements = document.querySelectorAll('.org-top-card-summary-info-list__info-item');
    let employeeCount = '';
    employeeElements.forEach((el) => {
      const text = el.textContent || '';
      if (text.includes('employees') || text.includes('employee')) {
        employeeCount = text.trim();
      }
    });
    
    // Website - look in the about section or sidebar
    const websiteElement = 
      document.querySelector('a[data-control-name="top_card_link_website"]') ||
      document.querySelector('.link-without-visited-state.org-top-card-primary-actions__action');
    const website = websiteElement?.getAttribute('href') || '';
    
    // Logo
    const logoElement = document.querySelector('.org-top-card-primary-content__logo');
    const logoUrl = logoElement?.getAttribute('src') || '';
    
    // Description/tagline
    const descElement = document.querySelector('.org-top-card-summary__tagline');
    const description = descElement?.textContent?.trim() || '';
    
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


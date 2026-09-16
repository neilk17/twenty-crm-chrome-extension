import { defineConfig } from 'wxt';

const buildChannel = process.env.BUILD_CHANNEL === 'beta' ? 'beta' : 'stable';
const extensionVersion = '1.0.15';
const isBeta = buildChannel === 'beta';

export default defineConfig({
  manifest: {
    name: isBeta
      ? 'Twenty CRM - LinkedIn Capture (Beta)'
      : 'Twenty CRM - LinkedIn Capture',
    short_name: isBeta ? 'Twenty CRM Beta' : 'Twenty CRM',
    version: extensionVersion,
    version_name: isBeta ? `${extensionVersion}-beta` : extensionVersion,
    description: isBeta
      ? 'Beta build: Quickly add LinkedIn profiles and companies to your Twenty CRM'
      : 'Quickly add LinkedIn profiles and companies to your Twenty CRM',

    icons: {
      "16": "logo-16.png",
      "32": "logo-32.png",
      "48": "logo-48.png",
      "128": "logo-128.png"
    },

    permissions: [
      "activeTab",
      "storage",
      // Reads the active tab's URL to detect LinkedIn pages and derive a company
      // domain. Does NOT grant access to page content, unlike a host permission.
      "tabs"
    ],

    // Only request LinkedIn access upfront. media.licdn.com is LinkedIn's image
    // CDN: the background script fetches profile photos from it to upload them
    // to Twenty.
    host_permissions: [
      "https://www.linkedin.com/*",
      "https://linkedin.com/*",
      "https://media.licdn.com/*",
    ],

    // No optional host patterns are declared. Twenty is self-hosted at arbitrary
    // domains, so the extension cannot enumerate them ahead of time, and any
    // pattern broad enough to cover them would amount to all-sites access.
    // Instead it asks for the single origin the user enters, at runtime, via
    // permissions.request(). Chrome allows this for origins not listed in the
    // manifest as long as the request is driven by a user gesture.
    //
    // The store surfaces optional_host_permissions as broad host access and
    // flags it for in-depth review; requesting at runtime keeps the declared
    // scope to LinkedIn only.

    action: {}
  }
});

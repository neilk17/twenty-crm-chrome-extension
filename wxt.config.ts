import { defineConfig } from 'wxt';

const buildChannel = process.env.BUILD_CHANNEL === 'beta' ? 'beta' : 'stable';
const extensionVersion = '1.0.8';
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
      "cookies"
    ],

    // Only request LinkedIn access upfront
    host_permissions: [
      "https://www.linkedin.com/*",
      "https://linkedin.com/*",
    ],

    // CRM domain access can be requested at runtime
    optional_host_permissions: [
      "*://*/*"
    ],

    action: {}
  }
});

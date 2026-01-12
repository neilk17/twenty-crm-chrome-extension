import { defineConfig } from 'wxt';
import { resolve } from 'node:path';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@': resolve('.'),
  },
  manifest: {
    name: 'Twenty CRM - LinkedIn Capture',
    description: 'Capture LinkedIn profiles and companies to your Twenty CRM',
    version: '1.0.0',
    permissions: ['storage', 'cookies', 'activeTab', 'sidePanel'],
    host_permissions: ['*://*.linkedin.com/*', '*://*/*'],
    action: {
      default_title: 'Twenty CRM - LinkedIn Capture',
    },
  },
});

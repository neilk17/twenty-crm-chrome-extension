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
      default_icon: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
        96: '/icon/96.png',
        128: '/icon/128.png',
      },
      default_title: 'Twenty CRM - LinkedIn Capture',
    },
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      96: '/icon/96.png',
      128: '/icon/128.png',
    },
  },
});

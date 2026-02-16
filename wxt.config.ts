import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: "Twenty CRM - LinkedIn Capture",
    version: "1.0.2", // Increment version
    description: "Quickly add LinkedIn profiles and companies to your Twenty CRM",

    icons: {
      "16": "logo-16.png",
      "32": "logo-32.png",
      "48": "logo-48.png",
      "128": "logo-128.png"
    },

    permissions: [
      "activeTab",
      "storage"
    ],

    // Only request LinkedIn access upfront
    host_permissions: [
      "https://www.linkedin.com/*",
      "https://linkedin.com/*"
    ],

    // CRM domain access can be requested at runtime
    optional_host_permissions: [
      "*://*/*"
    ],

    action: {}
  }
});

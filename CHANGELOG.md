# Changelog

All notable changes to Twenty CRM LinkedIn Capture Extension.

## [1.0.15] - 2026-09-16

### 🔐 Permissions

- The manifest no longer declares any optional host permissions. Access to your
  Twenty instance is requested at runtime for that one origin when you save its
  URL, so the extension never declares access to all sites. This also avoids the
  extended Chrome Web Store review that broad host access triggers.

### 🐛 Fixes

- The automatic connection check no longer tries to open a permission prompt.
  Chrome only allows that from a click, so the prompt now appears when you save
  the URL or press Test Connection, and the automatic check reports that access
  is still needed instead of silently failing.

## [1.0.14] - 2026-09-16

### 🔐 Permissions

- **No longer requests access to every website.** The optional `*://*/*` host
  permission is replaced by a request scoped to your own Twenty instance, made
  once you enter its URL. The extension reads the active tab's address via the
  `tabs` permission, which does not grant access to page content.
- Content scripts now inject only on LinkedIn profile and company pages. The
  previous build injected a script into every page you visited, which was used
  only to read the page's own URL.
- Added `media.licdn.com` so profile photo uploads keep working without
  all-sites access.

## [1.0.13] - 2026-09-15

### 🔒 Security

- The stored API key is now cleared when the Twenty URL is changed. Previously
  the key saved for one instance was kept and immediately sent to the newly
  entered host, which could disclose it to a mistyped or hostile URL. After
  changing the URL, enter a key for the new workspace.

### 🐛 Fixes

- The setup card no longer reports "Twenty is connected" while the banner says
  the key was rejected. The connection step is marked complete only once the key
  actually authenticates.

### 🔧 Technical

- Settings changes are resolved by a single tested function shared by the
  background handler.
- Removed dead cookie-era code and an unreachable permission error branch.

## [1.0.12] - 2026-09-15

### 💥 Breaking

- **Authentication now uses a Twenty API key.** Recent Twenty versions moved the
  web session into an httpOnly cookie and reject cookie-authenticated requests
  from any origin other than the Twenty app itself, so a browser extension can
  no longer reuse your signed-in session. After updating, open
  **Settings → APIs & Webhooks** in Twenty, create an API key, and paste it into
  the extension. The key is stored on this device only and is never synced.

### 🐛 Fixes

- Fixed the "Your Twenty session expired" loop that could not be cleared by
  signing in again.
- Fixed captures failing with `Object person doesn't have any "city" field` on
  Twenty versions that removed the `city` field from People, and the equivalent
  failure for `employees` on Companies. Optional fields are now checked against
  your workspace's schema and skipped when absent.

### 🔧 Technical

- All API calls send the key as a Bearer token and never send cookies.
- Removed the `cookies` permission, which is no longer needed.
- Connection probes query `currentWorkspace` first, since API keys carry a
  workspace but no user.
- Added a unit test suite (`npm test`) covering authentication and
  schema-dependent fields.

## [1.0.0] - 2024-12-17

### ✨ Features

- **LinkedIn Profile Capture** - One-click capture of LinkedIn profiles to Twenty CRM
- **Company Page Capture** - Capture LinkedIn company pages
- **Auto Company Creation** - Automatically creates company records when adding contacts
- **Profile Photo Upload** - Uploads LinkedIn profile photos to Twenty's storage via GraphQL
- **Duplicate Detection** - Checks for existing records by LinkedIn URL and name matching
- **Manual Linking** - Search CRM and link LinkedIn profile to existing contacts
- **Update from LinkedIn** - Refresh existing CRM records with current LinkedIn data
- **Multi-language Support** - Extracts company names from headlines in multiple languages:
  - English: "at Company"
  - French: "chez Company", "à Company"
  - German: "bei Company"
  - Spanish: "en Company"
  - Symbol: "@ Company"

### 🔧 Technical

- Session-based authentication using Twenty's existing login cookie
- GraphQL API integration for all CRM operations
- GraphQL multipart upload for profile photos
- Floating UI button with status indicators
- Menu dropdown for additional actions
- URL change detection for LinkedIn SPA navigation

### 📋 Data Captured

**People:**

- First name & Last name
- Job title / headline
- Profile photo (uploaded)
- Location
- LinkedIn URL
- Current company (linked or created)

**Companies:**

- Company name
- LinkedIn URL
- Website
- Employee count

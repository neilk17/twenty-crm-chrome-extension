# Changelog

All notable changes to Twenty CRM LinkedIn Capture Extension.

## [1.1.0] - 2026-02-21

### ✨ Features

- **Firefox Support** - Extension now works on Firefox in addition to Chrome
  - Uses Firefox sidebar API for the side panel
  - Cross-browser compatible script execution
  - Toolbar icon toggles sidebar on Firefox

### 🔧 Technical

- Added cross-browser detection for `browser.scripting` vs `browser.tabs.executeScript`
- Firefox uses Manifest V2 with `sidebar_action` instead of Chrome's `side_panel`
- Added `npm run dev:firefox`, `npm run build:firefox`, and `npm run zip:firefox` commands

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

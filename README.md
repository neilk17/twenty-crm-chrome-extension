# Twenty CRM Browser Extension

Install this browser extension and manage your Twenty CRM workspace from Linkedin, Gmail and anywhere on the web. 

##  Downloading the Extension

### Chrome Web Store (Beta)

**[Install from Chrome Web Store](https://chromewebstore.google.com/detail/twenty-crm-linkedin-captu/lcnlieolnenacjbhohgbnhkmniimlmli?authuser=0&hl=en)** — Note: this is still in beta.

### Chrome - Manual Install

1. **[⬇️ Download Latest Release](../../releases/latest)**
2. Download the `twenty-crm-linkedin-extension-*-chrome.zip` file
3. **Unzip** the file - you should see `manifest.json` and other files directly inside
4. Open Chrome → `chrome://extensions`
5. Enable **Developer mode** (toggle top right)
6. Click **Load unpacked** → select the **unzipped folder** (the one containing `manifest.json`)
7. Click the extension icon and enter your Twenty CRM URL

### Firefox - Manual Install

1. **[⬇️ Download Latest Release](../../releases/latest)**
2. Download the `twenty-crm-linkedin-extension-*-firefox.zip` file
3. Open Firefox → `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on** → select the **ZIP file** (or any file inside the unzipped folder)
5. Click the extension icon or use **View → Sidebar → Twenty CRM** to open the sidebar
6. Enter your Twenty CRM URL

> **Firefox Note**: Temporary add-ons are removed when Firefox restarts. For permanent installation, the extension needs to be signed by Mozilla or installed via `about:config` with `xpinstall.signatures.required` set to `false` (not recommended for security).

> **Note**: You must be logged into your Twenty CRM in the same browser for the extension to work.
>
> **Tip**: After unzipping, verify the folder contains `manifest.json` at the root level, not inside a subfolder.

---

## ✨ Features

| Feature                    | Description                                                |
| -------------------------- | ---------------------------------------------------------- |
| 🔗 **LinkedIn Capture**    | One-click capture of LinkedIn profiles to your CRM         |
| 🏢 **Company Auto-Create** | Automatically creates company records when adding contacts |
| 📸 **Photo Upload**        | Uploads LinkedIn profile photos directly to Twenty storage |
| 🔍 **Duplicate Detection** | Checks if contact/company exists by LinkedIn URL or name   |
| 🔄 **Update Existing**     | Refresh CRM records with latest LinkedIn data              |
| 🔎 **Manual Linking**      | Search and link LinkedIn profiles to existing CRM contacts |
| 🌍 **Multi-language**      | Extracts company names in EN, FR, DE, ES headlines         |

---

## 🚀 Usage

### Capturing a LinkedIn Profile

1. Visit any LinkedIn profile (`linkedin.com/in/username`)
2. Click the extension icon to open the **sidebar**:

   | Sidebar State      | Meaning                               |
   | ------------------ | ------------------------------------- |
   | **Add to Twenty**  | Profile not in CRM - click to add     |
   | **Open in Twenty** | Profile exists - click to view in CRM |

3. Additional options in the sidebar:
   - **Link to existing contact** - Search and link to existing record
   - **Update from LinkedIn** - Refresh CRM with current LinkedIn data

### Capturing a Company

Same process - visit any LinkedIn company page (`linkedin.com/company/name`) and open the sidebar

---

## 📋 Data Captured

### People

- ✅ First name & Last name
- ✅ Job title / headline
- ✅ Profile photo (uploaded to Twenty)
- ✅ Location
- ✅ LinkedIn URL
- ✅ Current company (auto-created if needed)

### Companies

- ✅ Company name
- ✅ LinkedIn URL
- ✅ Website (when available)
- ✅ Employee count
- ✅ Company logo

---

## 🛠️ Build from Source

```bash
# Clone the repository
git clone https://github.com/neilk17/twenty-crm-chrome-extension.git
cd twenty-crm-chrome-extension

# Install dependencies
npm install

# Development with hot reload
npm run dev           # Chrome
npm run dev:firefox   # Firefox

# Build for production
npm run build         # Chrome
npm run build:firefox # Firefox

# Create distributable ZIP
npm run zip           # Chrome
npm run zip:firefox   # Firefox
```

Built extensions:
- Chrome: `.output/chrome-mv3/`
- Firefox: `.output/firefox-mv2/`

---

### Debug Logs

- **Page console** (F12): Shows scraping logs
- **Service Worker**: Go to `chrome://extensions` → click "Service Worker" under the extension

---

## 📚 Tech Stack

- [WXT](https://wxt.dev/) - Web Extension Framework
- [React](https://react.dev/) - Sidepanel UI
- TypeScript
- Twenty CRM GraphQL API

---

## 📄 License

AGPL-3.0 license

---

## 🔗 Links

- [Twenty CRM](https://twenty.com)
- [WXT Documentation](https://wxt.dev)
- [Report an Issue](../../issues)

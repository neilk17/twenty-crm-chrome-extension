# Twenty CRM Chrome Extension

Install this Chrome extension and manage your Twenty CRM workspace from Linkedin, Gmail and anywhere on the web. 

Thanks to [https://github.com/JhumanJ/twenty-crm-extension](https://github.com/JhumanJ/twenty-crm-extension) for the base extension which this is a fork of.

##  Downloading the Extension

### Quick Install (Recommended)

1. **[⬇️ Download Latest Release](../../releases/latest)**
2. Download the `twenty-crm-linkedin-extension-*-chrome.zip` file
3. **Unzip** the file - you should see `manifest.json` and other files directly inside
4. Open Chrome → `chrome://extensions`
5. Enable **Developer mode** (toggle top right)
6. Click **Load unpacked** → select the **unzipped folder** (the one containing `manifest.json`)
7. Click the extension icon and enter your Twenty CRM URL

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
2. A button appears in the **bottom-left corner**:

   | Button State       | Meaning                               |
   | ------------------ | ------------------------------------- |
   | **Add to Twenty**  | Profile not in CRM - click to add     |
   | **Open in Twenty** | Profile exists - click to view in CRM |

3. Click `•••` for more options:
   - **Link to existing contact** - Search and link to existing record
   - **Update from LinkedIn** - Refresh CRM with current LinkedIn data

### Capturing a Company

Same process - visit any LinkedIn company page (`linkedin.com/company/name`)

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
npm run dev

# Build for production
npm run build

# Create distributable ZIP
npm run zip
```

The built extension is in `.output/chrome-mv3/`

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

MIT

---

## 🔗 Links

- [Twenty CRM](https://twenty.com)
- [WXT Documentation](https://wxt.dev)
- [Report an Issue](../../issues)

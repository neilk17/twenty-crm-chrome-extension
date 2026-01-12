import { useState, useEffect, useMemo } from "react";
import type {
  ExtensionResponse,
  CaptureState,
  LinkedInData,
} from "../../types";
import { getLinkedInPageType } from "../../utils/linkedin-scraper";

type RecentCapture = {
  linkedinUrl: string;
  name: string;
  type: "person" | "company";
  capturedAt: number;
  twentyId: string;
};

export default function App() {
  const [twentyUrl, setTwentyUrl] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recentCaptures, setRecentCaptures] = useState<RecentCapture[]>([]);
  const [captureState, setCaptureState] = useState<CaptureState>({
    status: "idle",
  });
  const [currentTabUrl, setCurrentTabUrl] = useState<string | null>(null);
  const [isCheckingPage, setIsCheckingPage] = useState(false);

  // Computed
  const isConfigured = useMemo(() => !!twentyUrl, [twentyUrl]);

  const connectionStatus = useMemo(() => {
    if (!isConfigured) return "not-configured";
    if (!hasToken) return "no-session";
    if (isConnected) return "connected";
    return "disconnected";
  }, [isConfigured, hasToken, isConnected]);

  const statusText = useMemo(() => {
    switch (connectionStatus) {
      case "not-configured":
        return "Not configured";
      case "no-session":
        return "Not logged in";
      case "connected":
        return "Connected";
      case "disconnected":
        return "Connection failed";
      default:
        return "Unknown";
    }
  }, [connectionStatus]);

  const statusColorClass = useMemo(() => {
    switch (connectionStatus) {
      case "connected":
        return "text-emerald-400";
      case "no-session":
        return "text-amber-400";
      default:
        return "text-red-400";
    }
  }, [connectionStatus]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadRecentCaptures();
    setTimeout(() => {
      checkCurrentTab();
    }, 100);

    const handleTabUpdate = (tabId: number, changeInfo: any, tab: any) => {
      if (changeInfo.url || changeInfo.status === "complete") {
        checkCurrentTab();
      }
    };

    const handleTabActivated = (activeInfo: any) => {
      checkCurrentTab();
    };

    browser.tabs.onUpdated.addListener(handleTabUpdate);
    browser.tabs.onActivated.addListener(handleTabActivated);

    return () => {
      browser.tabs.onUpdated.removeListener(handleTabUpdate);
      browser.tabs.onActivated.removeListener(handleTabActivated);
    };
  }, []);

  async function checkCurrentTab() {
    try {
      let tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tabs || tabs.length === 0 || !tabs[0]?.url) {
        tabs = await browser.tabs.query({
          active: true,
        });
      }

      // If still no tabs, try getting the last focused window
      if (!tabs || tabs.length === 0 || !tabs[0]?.url) {
        const windows = await browser.windows.getAll({ populate: true });
        for (const window of windows) {
          if (window.tabs) {
            const activeTab = window.tabs.find((tab) => tab.active);
            if (activeTab?.url) {
              tabs = [activeTab];
              break;
            }
          }
        }
      }

      if (tabs && tabs.length > 0 && tabs[0]?.url) {
        const url = tabs[0].url;
        console.log("Current tab URL:", url);
        setCurrentTabUrl(url);
        const pageType = getLinkedInPageType(url);
        console.log("Page type:", pageType);
        if (pageType && tabs[0].id) {
          await checkPageForCapture(tabs[0].id, url, pageType);
        } else {
          setCaptureState({ status: "idle" });
        }
      } else {
        console.log("No active tab found");
        setCurrentTabUrl(null);
        setCaptureState({ status: "idle" });
      }
    } catch (err) {
      console.error("Error checking current tab:", err);
      setCurrentTabUrl(null);
      setCaptureState({ status: "idle" });
    }
  }

  async function checkPageForCapture(
    tabId: number,
    url: string,
    pageType: "person" | "company"
  ) {
    setIsCheckingPage(true);
    setCaptureState({ status: "loading" });

    try {
      // Try to get data from content script first
      let scrapedData: LinkedInData | undefined;
      try {
        const scrapeResponse = (await browser.tabs.sendMessage(tabId, {
          type: "GET_PAGE_DATA",
        })) as ExtensionResponse<LinkedInData>;
        if (scrapeResponse.success && scrapeResponse.data) {
          scrapedData = scrapeResponse.data;
        }
      } catch (e) {
        // Content script might not be loaded, that's okay
        console.log(
          "Could not get data from content script, will check duplicate anyway"
        );
      }

      // Check for duplicate
      const response = (await browser.runtime.sendMessage({
        type: "CHECK_DUPLICATE",
        payload: {
          linkedinUrl: url.split("?")[0],
          pageType,
          scrapedData,
        },
      })) as ExtensionResponse<{
        exists: boolean;
        record?: { id: string; type: string };
        matchedBy?: string;
      }>;

      if (response.success) {
        if (response.data?.exists && response.data.record) {
          setCaptureState({
            status: "exists",
            existingRecord: {
              id: response.data.record.id,
              type: response.data.record.type as "person" | "company",
            },
            data: scrapedData,
          });
        } else {
          setCaptureState({
            status: "ready",
            data: scrapedData,
          });
        }
      } else {
        if (
          response.error?.includes("not configured") ||
          response.error?.includes("No authentication")
        ) {
          setCaptureState({ status: "idle", error: "Configure Twenty URL" });
        } else {
          setCaptureState({ status: "error", error: response.error });
        }
      }
    } catch (err) {
      console.error("Error checking page:", err);
      setCaptureState({ status: "error", error: "Failed to check page" });
    } finally {
      setIsCheckingPage(false);
    }
  }

  async function handleCapture() {
    if (captureState.status !== "ready" || !captureState.data) return;

    setCaptureState({ ...captureState, status: "saving" });

    try {
      const response = (await browser.runtime.sendMessage({
        type: "CREATE_RECORD",
        payload: captureState.data,
      })) as ExtensionResponse<{ id: string }>;

      if (response.success && response.data) {
        setCaptureState({
          status: "saved",
          existingRecord: {
            id: response.data.id,
            type: captureState.data.type,
          },
          data: captureState.data,
        });
        setSuccess("Added to Twenty CRM!");
        setTimeout(() => setSuccess(null), 3000);
        await loadRecentCaptures();

        // Update to exists state after a delay
        setTimeout(() => {
          setCaptureState((prev) => ({ ...prev, status: "exists" }));
        }, 2000);
      } else {
        setCaptureState({
          ...captureState,
          status: "error",
          error: response.error,
        });
        setError(response.error || "Failed to save");
      }
    } catch (err) {
      console.error("Error capturing:", err);
      setCaptureState({
        ...captureState,
        status: "error",
        error: "Failed to save",
      });
      setError("Failed to save");
    }
  }

  async function handleOpenInTwenty() {
    if (!captureState.existingRecord || !twentyUrl) return;
    const { id, type } = captureState.existingRecord;
    browser.tabs.create({
      url: `${twentyUrl}/object/${type}/${id}`,
    });
  }

  async function handleUpdate() {
    if (!captureState.existingRecord || !currentTabUrl) return;

    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tabs[0]?.id) return;

    setCaptureState({ ...captureState, status: "saving" });

    try {
      // Get fresh data from content script
      let scrapedData: LinkedInData | undefined;
      try {
        const scrapeResponse = (await browser.tabs.sendMessage(tabs[0].id, {
          type: "GET_PAGE_DATA",
        })) as ExtensionResponse<LinkedInData>;
        if (scrapeResponse.success && scrapeResponse.data) {
          scrapedData = scrapeResponse.data;
        }
      } catch (e) {
        setError("Could not get page data. Please refresh the LinkedIn page.");
        setCaptureState({ ...captureState, status: "error" });
        return;
      }

      if (!scrapedData) {
        setError("Could not extract profile data");
        setCaptureState({ ...captureState, status: "error" });
        return;
      }

      const response = (await browser.runtime.sendMessage({
        type: "UPDATE_RECORD",
        payload: {
          id: captureState.existingRecord.id,
          type: captureState.existingRecord.type,
          data: scrapedData,
        },
      })) as ExtensionResponse<{ id: string }>;

      if (response.success) {
        setCaptureState({
          ...captureState,
          status: "saved",
          data: scrapedData,
        });
        setSuccess("Updated in Twenty CRM!");
        setTimeout(() => setSuccess(null), 3000);
        setTimeout(() => {
          setCaptureState((prev) => ({ ...prev, status: "exists" }));
        }, 2000);
      } else {
        setCaptureState({
          ...captureState,
          status: "error",
          error: response.error,
        });
        setError(response.error || "Failed to update");
      }
    } catch (err) {
      console.error("Error updating:", err);
      setCaptureState({
        ...captureState,
        status: "error",
        error: "Failed to update",
      });
      setError("Failed to update");
    }
  }

  function getCaptureButtonText(): string {
    switch (captureState.status) {
      case "loading":
        return "Checking...";
      case "ready":
        return "Add to Twenty";
      case "exists":
        return "Open in Twenty";
      case "saving":
        return "Saving...";
      case "saved":
        return "Saved!";
      case "error":
        return captureState.error || "Error";
      default:
        return "Twenty CRM";
    }
  }

  function getCaptureButtonClass(): string {
    const base =
      "w-full px-4 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2";
    switch (captureState.status) {
      case "ready":
        return `${base} bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:shadow-lg`;
      case "exists":
      case "saved":
        return `${base} bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:shadow-lg`;
      case "saving":
      case "loading":
        return `${base} bg-gradient-to-r from-amber-500 to-orange-600 text-white`;
      case "error":
        return `${base} bg-gradient-to-r from-red-500 to-red-600 text-white`;
      default:
        return `${base} bg-gray-200 text-gray-700`;
    }
  }

  async function loadSettings() {
    setIsLoading(true);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "GET_SETTINGS",
      })) as ExtensionResponse<{ twentyUrl: string; hasToken: boolean }>;

      if (response.success && response.data) {
        setTwentyUrl(response.data.twentyUrl || "");
        setHasToken(response.data.hasToken || false);

        if (response.data.hasToken) {
          await testConnection();
        }
      }
    } catch (err) {
      console.error("Error loading settings:", err);
      setError("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadRecentCaptures() {
    try {
      const response = (await browser.runtime.sendMessage({
        type: "GET_RECENT_CAPTURES",
      })) as ExtensionResponse<RecentCapture[]>;

      if (response.success && response.data) {
        setRecentCaptures(response.data);
      }
    } catch (err) {
      console.error("Error loading recent captures:", err);
    }
  }

  async function saveSettings() {
    if (!twentyUrl) {
      setError("Please enter your Twenty URL");
      return;
    }

    // Normalize URL
    let url = twentyUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    url = url.replace(/\/$/, ""); // Remove trailing slash
    setTwentyUrl(url);

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = (await browser.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        payload: { twentyUrl: url },
      })) as ExtensionResponse;

      if (response.success) {
        setSuccess("Settings saved!");
        // Reload to check token
        await loadSettings();
      } else {
        setError(response.error || "Failed to save settings");
      }
    } catch (err) {
      console.error("Error saving settings:", err);
      setError("Failed to save settings");
    } finally {
      setIsSaving(false);
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    }
  }

  async function testConnection() {
    setIsTesting(true);
    setError(null);

    try {
      const response = (await browser.runtime.sendMessage({
        type: "TEST_CONNECTION",
      })) as ExtensionResponse<{ connected: boolean }>;

      const connected = response.success && response.data?.connected === true;
      setIsConnected(connected);

      if (!connected) {
        setError(
          response.error || "Connection test failed. Check your URL and login."
        );
      } else {
        setSuccess("Connection successful!");
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      console.error("Error testing connection:", err);
      setIsConnected(false);
      const errorMessage =
        err instanceof Error ? err.message : "Connection test failed";
      setError(errorMessage);
    } finally {
      setIsTesting(false);
    }
  }

  function openTwenty() {
    if (twentyUrl) {
      browser.tabs.create({ url: twentyUrl });
    }
  }

  function openRecord(record: { twentyId: string; type: string }) {
    if (twentyUrl) {
      // URL uses singular: /object/person/ and /object/company/
      browser.tabs.create({
        url: `${twentyUrl}/object/${record.type}/${record.twentyId}`,
      });
    }
  }

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      saveSettings();
    }
  }

  return (
    <div className="w-full max-w-[500px] min-h-screen font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2">
        <div className="flex items-center gap-2.5">
          <span className="text-base font-semibold">Twenty CRM</span>
        </div>
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium bg-white/20 ${statusColorClass}`}
        >
          <span className="w-2 h-2 rounded-full bg-current"></span>
          {statusText}
        </div>
      </header>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-[60px] px-5 gap-3 text-gray-500">
          <div className="w-6 h-6 border-2 rounded-full animate-spin"></div>
          <span>Loading...</span>
        </div>
      ) : (
        /* Main Content */
        <main className="px-5 pb-5">
          {/* LinkedIn Capture Button - Show first if on LinkedIn page */}
          {isConfigured && hasToken && (
            <section className="mb-5">
              {currentTabUrl && getLinkedInPageType(currentTabUrl) ? (
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-indigo-600"
                      >
                        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" />
                        <circle cx="4" cy="4" r="2" />
                      </svg>
                      <h3 className="text-sm font-semibold text-gray-700">
                        LinkedIn Page
                      </h3>
                    </div>
                    <button
                      onClick={checkCurrentTab}
                      className="text-xs text-gray-500 hover:text-gray-700 p-1"
                      title="Refresh"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                      </svg>
                    </button>
                  </div>
                  <button
                    className={getCaptureButtonClass()}
                    onClick={() => {
                      if (captureState.status === "ready") {
                        handleCapture();
                      } else if (
                        captureState.status === "exists" ||
                        captureState.status === "saved"
                      ) {
                        handleOpenInTwenty();
                      } else if (
                        captureState.status === "error" ||
                        captureState.status === "idle"
                      ) {
                        checkCurrentTab();
                      }
                    }}
                    disabled={
                      captureState.status === "loading" ||
                      captureState.status === "saving"
                    }
                  >
                    {(captureState.status === "loading" ||
                      captureState.status === "saving") && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    )}
                    {captureState.status === "ready" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    )}
                    {captureState.status === "exists" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                      </svg>
                    )}
                    {captureState.status === "saved" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                    {captureState.status === "error" && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M15 9l-6 6M9 9l6 6" />
                      </svg>
                    )}
                    <span>{getCaptureButtonText()}</span>
                  </button>
                  {captureState.status === "exists" && (
                    <button
                      className="mt-2 w-full px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                      onClick={handleUpdate}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                      </svg>
                      Update from LinkedIn
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-gray-400"
                    >
                      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" />
                      <circle cx="4" cy="4" r="2" />
                    </svg>
                    <h3 className="text-sm font-semibold text-gray-600">
                      Not on a LinkedIn Page
                    </h3>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Navigate to a LinkedIn profile or company page to capture
                    it.
                  </p>
                  <button
                    onClick={checkCurrentTab}
                    className="w-full px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Check Current Tab
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Settings Section */}
          <section className="mb-5">
            <div className="mb-4">
              <label
                className="block text-sm font-medium mb-1.5 text-gray-700"
                htmlFor="twentyUrl"
              >
                Twenty URL
              </label>
              <input
                id="twentyUrl"
                type="url"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm transition-all box-border focus:outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/10"
                placeholder="https://your-twenty.com"
                value={twentyUrl}
                onChange={(e) => setTwentyUrl(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <p className="text-xs text-gray-400 ">
                Your self-hosted Twenty instance URL
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                className="flex-1 px-4 py-2.5 border-none rounded-lg text-sm font-medium cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
                disabled={isSaving}
                onClick={saveSettings}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button
                className="flex-1 px-4 py-2.5 border-none rounded-lg text-sm font-medium cursor-pointer transition-all bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isTesting || !isConfigured}
                onClick={testConnection}
              >
                {isTesting ? "Testing..." : "Test Connection"}
              </button>
            </div>

            {/* Messages */}
            {error && (
              <div className="mt-3 px-3 py-2.5 rounded-lg text-[13px] bg-red-50 text-red-600">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-3 px-3 py-2.5 rounded-lg text-[13px] bg-green-50 text-green-600">
                {success}
              </div>
            )}
          </section>

          {/* Login Prompt */}
          {isConfigured && !hasToken && (
            <section className="bg-amber-100 p-4 rounded-lg mx-[-20px] mb-5 px-5">
              <p className="text-sm text-amber-800 mb-3">
                Please log in to your Twenty instance to use the extension.
              </p>
              <button
                className="flex-1 px-4 py-2.5 border-none rounded-lg text-sm font-medium cursor-pointer transition-all hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(99,102,241,0.4)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
                onClick={openTwenty}
              >
                Open Twenty →
              </button>
            </section>
          )}

          {/* Recent Captures */}
          {recentCaptures.length > 0 && (
            <section className="mb-5">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Recent Captures
              </h2>
              <ul className="list-none p-0 m-0">
                {recentCaptures.map((capture) => (
                  <li
                    key={capture.twentyId}
                    className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg mb-2 cursor-pointer transition-colors hover:bg-gray-100"
                    onClick={() => openRecord(capture)}
                  >
                    <div className="flex items-center justify-center w-8 h-8 bg-gray-200 rounded-full text-gray-500">
                      {capture.type === "person" ? (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                        {capture.name}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatDate(capture.capturedAt)}
                      </span>
                    </div>
                    <svg
                      className="text-gray-400"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      )}
    </div>
  );
}

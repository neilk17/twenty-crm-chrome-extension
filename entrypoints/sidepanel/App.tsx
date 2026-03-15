import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	Building2,
	Link,
	RefreshCw,
	Sparkles,
	User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getLinkedInPageType } from "../../lib/linkedin-scraper";
import {
	getTwentyOriginPatterns,
	normalizeTwentyUrl,
} from "../../lib/twenty-url";
import type {
	CaptureState,
	ExtensionResponse,
	LinkedInData,
	LinkedInProfileData,
	DomainCompanyData,
} from "../../types";

type RecentCapture = {
	linkedinUrl: string;
	name: string;
	type: "person" | "company";
	capturedAt: number;
	twentyId: string;
};

type BrowserTab = {
	id?: number;
	url?: string;
	active?: boolean;
};

function isBrowserInternalUrl(url: string): boolean {
	try {
		const protocol = new URL(url).protocol;
		return (
			protocol === "chrome:" ||
			protocol === "chrome-extension:" ||
			protocol === "edge:" ||
			protocol === "moz-extension:" ||
			protocol === "about:" ||
			protocol === "brave:"
		);
	} catch {
		return true;
	}
}

function isConfiguredTwentyTab(url: string, twentyUrl: string): boolean {
	if (!twentyUrl) return false;

	try {
		const tabOrigin = new URL(url).origin;
		const configuredOrigin = new URL(twentyUrl).origin;
		return tabOrigin === configuredOrigin;
	} catch {
		return false;
	}
}

function isLinkedInHost(url: string): boolean {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
	} catch {
		return false;
	}
}

function isIgnoredCompanyDomain(domain: string): boolean {
	return domain === "linkedin.com";
}

export default function App() {
	const [savedTwentyUrl, setSavedTwentyUrl] = useState("");
	const [twentyUrlInput, setTwentyUrlInput] = useState("");
	const [hasToken, setHasToken] = useState(false);
	const [isConnected, setIsConnected] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [isTesting, setIsTesting] = useState(false);
	const [isEditingTwentyUrl, setIsEditingTwentyUrl] = useState(false);
	const [isSetupCardCollapsed, setIsSetupCardCollapsed] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [recentCaptures, setRecentCaptures] = useState<RecentCapture[]>([]);
	const [captureState, setCaptureState] = useState<CaptureState>({
		status: "idle",
	});
	const [autoFetchAttempts, setAutoFetchAttempts] = useState(0);

	const [currentTabUrl, setCurrentTabUrl] = useState<string | null>(null);
	const [isCheckingPage, setIsCheckingPage] = useState(false);

	// Computed
	const isConfigured = useMemo(() => !!savedTwentyUrl, [savedTwentyUrl]);
	const extensionVersion = useMemo(() => {
		const manifest = browser.runtime.getManifest();
		return manifest.version_name || manifest.version;
	}, []);
	const isOnTwentyWorkspace = useMemo(
		() =>
			currentTabUrl ? isConfiguredTwentyTab(currentTabUrl, savedTwentyUrl) : false,
		[currentTabUrl, savedTwentyUrl],
	);
	const canCollapseSetupCard = useMemo(
		() => isConfigured && hasToken && isConnected && !isEditingTwentyUrl,
		[hasToken, isConfigured, isConnected, isEditingTwentyUrl],
	);

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

	const setupSteps = useMemo(
		() => [
			{
				title: "Save your Twenty URL",
				complete: isConfigured,
				description: isConfigured
					? "Saved in this browser."
					: "Enter the exact URL where you open Twenty, then click Save.",
			},
			{
				title: "Allow access and test it",
				complete: isConnected,
				description: isConnected
					? "The extension can reach your Twenty workspace."
					: "After saving, allow the browser permission prompt and run Test Connection.",
			},
			{
				title: "Sign in to Twenty",
				complete: hasToken,
				description: hasToken
					? "An active Twenty session was detected."
					: "Open Twenty, sign in, then come back to capture LinkedIn pages and company sites.",
			},
		],
		[hasToken, isConfigured, isConnected],
	);

	async function ensureTwentyPermission(urlValue: string): Promise<boolean> {
		const origins = getTwentyOriginPatterns(urlValue);
		if (origins.length === 0) {
			return false;
		}

		try {
			const hasPermission = await browser.permissions.contains({ origins });
			if (hasPermission) {
				return true;
			}
			return await browser.permissions.request({ origins });
		} catch (err) {
			console.error("Error requesting permission:", err);
			return false;
		}
	}

	// Load settings on mount (intentionally run once; handlers are stable by convention)
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only init
	useEffect(() => {
		loadSettings();
		loadRecentCaptures();
		setTimeout(() => {
			checkCurrentTab();
		}, 100);

		const handleTabUpdate = (
			_tabId: number,
			changeInfo: { url?: string; status?: string },
		) => {
			if (changeInfo.url || changeInfo.status === "complete") {
				checkCurrentTab();
			}
		};

		const handleTabActivated = () => {
			checkCurrentTab();
		};

		browser.tabs.onUpdated.addListener(handleTabUpdate);
		browser.tabs.onActivated.addListener(handleTabActivated);

		return () => {
			browser.tabs.onUpdated.removeListener(handleTabUpdate);
			browser.tabs.onActivated.removeListener(handleTabActivated);
		};
	}, []);

	// Re-check the active LinkedIn tab once configuration/auth become available.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when URL/token change
	useEffect(() => {
		if (savedTwentyUrl && hasToken) {
			checkCurrentTab();
		}
	}, [savedTwentyUrl, hasToken]);

	useEffect(() => {
		if (canCollapseSetupCard) {
			setIsSetupCardCollapsed(true);
			return;
		}

		setIsSetupCardCollapsed(false);
	}, [canCollapseSetupCard]);

	// Reset auto-fetch attempts whenever the active URL changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: currentTabUrl is the trigger for reset
	useEffect(() => {
		setAutoFetchAttempts(0);
	}, [currentTabUrl]);

	// If state is still idle on a LinkedIn page, retry automatically without requiring a button click.
	// biome-ignore lint/correctness/useExhaustiveDependencies: checkCurrentTab intentionally not in deps to avoid retry loops
	useEffect(() => {
		if (!savedTwentyUrl || !hasToken || isCheckingPage || isLoading) return;
		if (!currentTabUrl || !getLinkedInPageType(currentTabUrl)) return;
		if (captureState.status !== "idle") return;
		if (autoFetchAttempts >= 3) return;

		const timeout = setTimeout(() => {
			setAutoFetchAttempts((prev) => prev + 1);
			checkCurrentTab();
		}, 400);

		return () => clearTimeout(timeout);
	}, [
		savedTwentyUrl,
		hasToken,
		isCheckingPage,
		isLoading,
		currentTabUrl,
		captureState.status,
		autoFetchAttempts,
	]);

	async function checkCurrentTab() {
		try {
			const activeTab = await getActivePageTab();

			if (activeTab?.url) {
				const url = activeTab.url;
				setCurrentTabUrl(url);
				const pageType = getLinkedInPageType(url);
				if (pageType && activeTab.id) {
					// LinkedIn page - use existing flow
					await checkPageForCapture(activeTab.id, url, pageType);
				} else if (isLinkedInHost(url)) {
					setCaptureState({ status: "idle" });
				} else if (activeTab.id) {
					// Non-LinkedIn page - check for domain-based company
					await checkDomainForCapture(activeTab.id, url);
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

	async function getActivePageTab(): Promise<BrowserTab | null> {
		const candidates: BrowserTab[] = [];
		const seenTabIds = new Set<number>();

		const pushTabs = (tabs?: BrowserTab[]) => {
			for (const tab of tabs || []) {
				if (!tab?.id || seenTabIds.has(tab.id) || !tab.url) continue;
				if (isBrowserInternalUrl(tab.url)) continue;
				seenTabIds.add(tab.id);
				candidates.push(tab);
			}
		};

		pushTabs(
			await browser.tabs.query({
				active: true,
				lastFocusedWindow: true,
			}),
		);

		pushTabs(
			await browser.tabs.query({
				active: true,
				currentWindow: true,
			}),
		);

		try {
			const lastFocusedWindow = await browser.windows.getLastFocused({
				populate: true,
			});
			pushTabs(lastFocusedWindow.tabs);
		} catch (error) {
			console.warn("Could not inspect last focused window:", error);
		}

		pushTabs(
			await browser.tabs.query({
				active: true,
			}),
		);

		if (candidates.length === 0) {
			return null;
		}

		return (
			candidates.find(
				(tab) => !isConfiguredTwentyTab(tab.url || "", savedTwentyUrl),
			) ||
			candidates[0]
		);
	}

	async function checkPageForCapture(
		tabId: number,
		url: string,
		pageType: "person" | "company",
	) {
		if (!savedTwentyUrl || !hasToken) {
			setCaptureState({ status: "idle" });
			return;
		}

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
			} catch {
				// Content script might not be loaded, that's okay
				console.log(
					"Could not get data from content script, will check duplicate anyway",
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

	async function checkDomainForCapture(tabId: number, _url: string) {
		setIsCheckingPage(true);
		setCaptureState({ status: "loading" });

		try {
			// Get domain from page
			const domainResponse = (await browser.runtime.sendMessage({
				type: "GET_DOMAIN_FROM_PAGE",
				payload: { tabId },
			})) as ExtensionResponse<{ domain: string; url: string }>;

			if (!domainResponse.success || !domainResponse.data?.domain) {
				setCaptureState({ status: "idle" });
				return;
			}

			if (isConfiguredTwentyTab(domainResponse.data.url, savedTwentyUrl)) {
				setCaptureState({ status: "idle" });
				return;
			}

			const domain = domainResponse.data.domain;
			if (isIgnoredCompanyDomain(domain)) {
				setCaptureState({ status: "idle" });
				return;
			}

			// Check for duplicate by domain
			const duplicateResponse = (await browser.runtime.sendMessage({
				type: "CHECK_DUPLICATE_BY_DOMAIN",
				payload: { domain },
			})) as ExtensionResponse<{
				exists: boolean;
				record?: { id: string; type: string };
				matchedBy?: string;
			}>;

			if (duplicateResponse.success) {
				if (duplicateResponse.data?.exists && duplicateResponse.data.record) {
					setCaptureState({
						status: "exists",
						existingRecord: {
							id: duplicateResponse.data.record.id,
							type: duplicateResponse.data.record.type as "person" | "company",
						},
						data: {
							type: "company",
							domain,
						} as DomainCompanyData,
					});
				} else {
					setCaptureState({
						status: "ready",
						data: {
							type: "company",
							domain,
						} as DomainCompanyData,
					});
				}
			} else {
				if (
					duplicateResponse.error?.includes("not configured") ||
					duplicateResponse.error?.includes("No authentication")
				) {
					setCaptureState({ status: "idle", error: "Configure Twenty URL" });
				} else {
					// Duplicate check failed transiently — still show the domain so the user can add it.
					setCaptureState({ status: "ready", data: { type: "company", domain } as DomainCompanyData });
				}
			}
		} catch (err) {
			console.error("Error checking domain:", err);
			setCaptureState({ status: "error", error: "Failed to check domain" });
		} finally {
			setIsCheckingPage(false);
		}
	}

	async function handleCapture() {
		if (captureState.status !== "ready" || !captureState.data) return;

		setCaptureState({ ...captureState, status: "saving" });

		try {
			// Check if this is a domain-based company
			if (
				captureState.data.type === "company" &&
				"domain" in captureState.data
			) {
				const domainData = captureState.data as DomainCompanyData;
				const response = (await browser.runtime.sendMessage({
					type: "CREATE_COMPANY_BY_DOMAIN",
					payload: {
						domain: domainData.domain,
						companyName: domainData.name,
					},
				})) as ExtensionResponse<{ id: string }>;

				if (response.success && response.data) {
					setCaptureState({
						status: "saved",
						existingRecord: {
							id: response.data.id,
							type: "company",
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
			} else {
				// LinkedIn-based capture (existing flow)
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
		if (!captureState.existingRecord || !savedTwentyUrl) return;
		const { id, type } = captureState.existingRecord;
		browser.tabs.create({
			url: `${savedTwentyUrl}/object/${type}/${id}`,
		});
	}

	async function handleUpdate() {
		if (!captureState.existingRecord || !currentTabUrl) return;

		const activeTab = await getActivePageTab();
		if (!activeTab?.id) return;

		setCaptureState({ ...captureState, status: "saving" });

		try {
			// Get fresh data from content script
			let scrapedData: LinkedInData | undefined;
			try {
				const scrapeResponse = (await browser.tabs.sendMessage(activeTab.id, {
					type: "GET_PAGE_DATA",
				})) as ExtensionResponse<LinkedInData>;
				if (scrapeResponse.success && scrapeResponse.data) {
					scrapedData = scrapeResponse.data;
				}
			} catch {
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
		const isDomainCapture =
			!!captureState.data &&
			captureState.data.type === "company" &&
			"domain" in captureState.data;

		switch (captureState.status) {
			case "idle":
				return isDomainCapture ? "Check website" : "Checking profile...";
			case "loading":
				return isDomainCapture ? "Checking company..." : "Checking...";
			case "ready":
				return isDomainCapture ? "Add company" : "Add to Twenty CRM";
			case "exists":
				return "Open in Twenty";
			case "saving":
				return isDomainCapture ? "Adding company..." : "Saving...";
			case "saved":
				return isDomainCapture ? "Company added" : "Saved!";
			case "error":
				return captureState.error || "Error";
			default:
				return "Twenty CRM";
		}
	}

	async function loadSettings() {
		setIsLoading(true);
		try {
			const response = (await browser.runtime.sendMessage({
				type: "GET_SETTINGS",
			})) as ExtensionResponse<{
				twentyUrl: string;
				hasToken: boolean;
				invalidTwentyUrl?: string;
			}>;

			if (response.success && response.data) {
				const normalizedTwentyUrl = response.data.twentyUrl || "";
				const invalidTwentyUrl = response.data.invalidTwentyUrl || "";
				setSavedTwentyUrl(normalizedTwentyUrl);
				setTwentyUrlInput(invalidTwentyUrl || normalizedTwentyUrl);
				setIsEditingTwentyUrl(!normalizedTwentyUrl);
				setHasToken(invalidTwentyUrl ? false : (response.data.hasToken || false));
				setError(
					invalidTwentyUrl
						? "Saved Twenty URL is invalid. Enter your full workspace URL again."
						: null,
				);
				setSuccess(null);

				if (normalizedTwentyUrl && response.data.hasToken && !invalidTwentyUrl) {
					await testConnection(normalizedTwentyUrl, { showSuccess: false });
				} else {
					setIsConnected(false);
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
		if (!twentyUrlInput) {
			setError("Please enter your Twenty URL");
			return;
		}

		const url = normalizeTwentyUrl(twentyUrlInput);
		if (!url) {
			setError(
				"Enter a valid Twenty URL, for example https://app.twenty.com or https://crm.example.com.",
			);
			return;
		}
		setTwentyUrlInput(url);

		setIsSaving(true);
		setError(null);
		setSuccess(null);

		try {
			const hasPermission = await ensureTwentyPermission(url);
			if (!hasPermission) {
				setError(
					"Permission denied. Please allow access to your Twenty domain.",
				);
				return;
			}

			const response = (await browser.runtime.sendMessage({
				type: "SAVE_SETTINGS",
				payload: { twentyUrl: url },
			})) as ExtensionResponse;

			if (response.success) {
				setSavedTwentyUrl(url);
				setTwentyUrlInput(url);
				setIsEditingTwentyUrl(false);
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

	async function testConnection(
		urlOverride?: string,
		options?: { showSuccess?: boolean },
	) {
		const targetUrl = normalizeTwentyUrl(urlOverride || savedTwentyUrl);
		if (!targetUrl) {
			setError(
				"Enter a valid Twenty URL, for example https://app.twenty.com or https://crm.example.com.",
			);
			return;
		}

		setIsTesting(true);
		setError(null);

		try {
			const hasPermission = await ensureTwentyPermission(targetUrl);
			if (!hasPermission) {
				setError(
					"Permission denied. Please allow access to your Twenty domain.",
				);
				setIsConnected(false);
				return;
			}

			const response = (await browser.runtime.sendMessage({
				type: "TEST_CONNECTION",
			})) as ExtensionResponse<{ connected: boolean }>;

			const connected = response.success && response.data?.connected === true;
			setIsConnected(connected);

			if (!connected) {
				setError(
					response.error || "Connection test failed. Check your URL and login.",
				);
			} else if (options?.showSuccess !== false) {
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

	function handleEditTwentyUrl() {
		setTwentyUrlInput(savedTwentyUrl);
		setIsEditingTwentyUrl(true);
		setError(null);
		setSuccess(null);
	}

	function handleCancelTwentyUrlEdit() {
		setTwentyUrlInput(savedTwentyUrl);
		setIsEditingTwentyUrl(false);
		setError(null);
		setSuccess(null);
	}

	function openTwenty() {
		if (savedTwentyUrl) {
			browser.tabs.create({ url: savedTwentyUrl });
		}
	}

	function openRecord(record: { twentyId: string; type: string }) {
		if (savedTwentyUrl) {
			// URL uses singular: /object/person/ and /object/company/
			browser.tabs.create({
				url: `${savedTwentyUrl}/object/${record.type}/${record.twentyId}`,
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
		<div className="flex min-h-full w-full max-w-[500px] flex-col font-sans bg-card/10">
			{isLoading ? (
				<div className="flex flex-col items-center justify-center py-[60px] px-5 gap-3 ">
					<div className="w-6 h-6 border-2 rounded-full animate-spin"></div>
					<span>Loading...</span>
				</div>
			) : (
				<main className="mx-4 mt-4 flex flex-1 flex-col pb-4">
					<section className="mb-5">
						{canCollapseSetupCard && isSetupCardCollapsed ? (
							<button
								type="button"
								className="flex w-full items-center justify-between rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-accent/20"
								onClick={() => setIsSetupCardCollapsed(false)}
							>
								<div className="flex min-w-0 items-center gap-3">
									<Avatar className="size-10">
										<AvatarFallback>20</AvatarFallback>
									</Avatar>
									<div className="flex min-w-0 flex-col gap-1">
										<p className="text-sm font-semibold">Twenty connected</p>
										<p className="truncate text-xs text-muted-foreground">
											{savedTwentyUrl}
										</p>
									</div>
								</div>
								<Badge variant="secondary">Connected</Badge>
							</button>
						) : (
						<Card>
							<CardHeader>
								<div className="flex flex-col gap-2">
									<CardTitle>
										{isConfigured && !isEditingTwentyUrl
											? hasToken
												? "Twenty is connected"
												: "Finish your Twenty setup"
											: "Set up Twenty"}
									</CardTitle>
									<CardDescription>
										{isConfigured && !isEditingTwentyUrl
											? "Your workspace URL is saved. The extension ignores this host when suggesting companies."
											: "New install? Follow these steps once, then use the extension on LinkedIn pages or any company website."}
									</CardDescription>
								</div>
								<CardAction>
									<div className="flex items-center gap-2">
										<Badge variant="secondary">{statusText}</Badge>
										{canCollapseSetupCard && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setIsSetupCardCollapsed(true)}
											>
												Hide
											</Button>
										)}
									</div>
								</CardAction>
							</CardHeader>
							<CardContent className="flex flex-col gap-4">
								<div className="flex flex-col gap-3 rounded-lg bg-sidebar/50 p-4">
									{setupSteps.map((step, index) => (
										<div key={step.title} className="flex items-start gap-3">
											<Badge variant={step.complete ? "default" : "outline"}>
												{step.complete ? "Done" : index + 1}
											</Badge>
											<div className="flex flex-col gap-1">
												<p className="text-sm font-medium">{step.title}</p>
												<p className="text-xs text-muted-foreground">
													{step.description}
												</p>
											</div>
										</div>
									))}
								</div>

								{isConfigured && !isEditingTwentyUrl ? (
									<div className="flex flex-col gap-2 rounded-lg border p-4">
										<div className="flex flex-col gap-1">
											<p className="text-xs font-medium text-muted-foreground">
												Saved Twenty URL
											</p>
											<p className="break-all font-mono text-sm">{savedTwentyUrl}</p>
										</div>
										<p className="text-xs text-muted-foreground">
											Your CRM host is excluded from website company capture, so
											the extension will not try to add it as a new company.
										</p>
									</div>
								) : (
									<div className="grid w-full items-center gap-3">
										<Label htmlFor="twentyUrl">Twenty URL</Label>
										<InputGroup>
											<InputGroupInput
												id="twentyUrl"
												placeholder="https://app.twenty.com or your domain"
												value={twentyUrlInput}
												onChange={(e) => setTwentyUrlInput(e.target.value)}
												onKeyDown={handleKeyDown}
											/>

											<InputGroupAddon align="inline-end">
												<Badge variant="secondary">{statusText}</Badge>
											</InputGroupAddon>
										</InputGroup>

										<p className="text-xs text-muted-foreground">
											Use the same URL you open for Twenty. Save it once, allow
											access when prompted, then sign in to Twenty.
										</p>
									</div>
								)}

								{isConfigured && !hasToken && !isEditingTwentyUrl && (
									<div className="rounded-lg border border-dashed p-4">
										<p className="text-sm font-medium">One step left</p>
										<p className="mt-1 text-xs text-muted-foreground">
											Open Twenty, sign in, then come back here and click
											&quot;I&apos;ve signed in&quot;.
										</p>
									</div>
								)}

								{error && (
									<div role="alert" className="rounded-lg bg-status-error-bg px-3 py-2.5 text-xs text-status-error">
										{error}
									</div>
								)}
								{success && (
									<div role="status" aria-live="polite" className="rounded-lg bg-status-success-bg px-3 py-2.5 text-xs text-status-success">
										{success}
									</div>
								)}
							</CardContent>
							<CardFooter className="flex flex-col gap-2 sm:flex-row">
								{isConfigured && !isEditingTwentyUrl ? (
									<>
										<Button className="flex-1" onClick={openTwenty}>
											Open Twenty
										</Button>
										<Button
											className="flex-1"
											variant="outline"
											onClick={
												hasToken
													? () => testConnection(undefined, { showSuccess: true })
													: loadSettings
											}
											disabled={isTesting}
										>
											{isTesting
												? "Testing..."
												: hasToken
													? "Test Connection"
													: "I've signed in"}
										</Button>
										<Button
											className="flex-1"
											variant="ghost"
											onClick={handleEditTwentyUrl}
										>
											Edit URL
										</Button>
									</>
								) : (
									<>
										<Button
											className="flex-1"
											disabled={isSaving}
											onClick={saveSettings}
										>
											{isSaving ? "Saving..." : "Save URL"}
										</Button>
										<Button
											className="flex-1"
											variant="outline"
											disabled={isTesting || !isConfigured || isEditingTwentyUrl}
											onClick={() => testConnection(undefined, { showSuccess: true })}
										>
											{isTesting ? "Testing..." : "Test Connection"}
										</Button>
										{isConfigured && (
											<Button
												className="flex-1"
												variant="ghost"
												onClick={handleCancelTwentyUrlEdit}
											>
												Cancel
											</Button>
										)}
									</>
								)}
							</CardFooter>
						</Card>
						)}
					</section>

					{isConfigured && hasToken && !isOnTwentyWorkspace && (
						<section className="mb-5">
							{currentTabUrl && getLinkedInPageType(currentTabUrl) ? (
								<div className="bg-card rounded-lg p-4 border ">
									{captureState.data && (
										<div className="mb-3 flex flex-col gap-2">
											<div className="flex items-center gap-2">
												<Avatar>
													<AvatarFallback>
														<User className="size-4" />
													</AvatarFallback>
												</Avatar>
												<h3 className="font-semibold text-xl">
													{captureState.data.type === "person"
														? `${captureState.data.firstName} ${captureState.data.lastName}`
														: captureState.data.name}
												</h3>
											</div>
											<div>
												<p className="text-sm text-muted-foreground">
													{captureState.data.type === "person"
														? (captureState.data
																.headline as LinkedInProfileData["headline"])
														: "description" in captureState.data
															? captureState.data.description
															: null}
												</p>
												<p className="text-sm text-muted-foreground">
													{captureState.data.type === "person"
														? captureState.data.currentCompany
														: "industry" in captureState.data
															? captureState.data.industry
															: null}
												</p>
											</div>
										</div>
									)}
									<Button
										variant="default"
										className="w-full"
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
											<div className="w-4 h-4 border-2 border-border border-t-transparent rounded-full animate-spin"></div>
										)}
										<Sparkles />
										<span>{getCaptureButtonText()}</span>
									</Button>
									{captureState.status === "exists" &&
										captureState.data &&
										!("domain" in captureState.data) && (
											<Button
												className="mt-2 w-full"
												variant="secondary"
												onClick={handleUpdate}
											>
												<RefreshCw className="size-4" />
												Refresh data from LinkedIn
											</Button>
										)}
								</div>
							) : (
								<div className="bg-card rounded-lg p-4 border ">
									{captureState.data && "domain" in captureState.data ? (
										<>
											<div className="mb-3 flex flex-col gap-2">
												<div className="flex items-center gap-2">
													<Avatar>
														<AvatarFallback>
															<Building2 className="size-4" />
														</AvatarFallback>
													</Avatar>
													<h3 className="font-semibold text-xl">
														{(captureState.data as DomainCompanyData).domain}
													</h3>
												</div>
												<div>
													<p className="text-sm text-muted-foreground">
														Company Domain
													</p>
												</div>
											</div>
											<Button
												variant="default"
												className="w-full"
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
													<div className="w-4 h-4 border-2 border-border border-t-transparent rounded-full animate-spin"></div>
												)}
												<Sparkles />
												<span>{getCaptureButtonText()}</span>
											</Button>
										</>
									) : (
										<>
											<div className="flex items-center gap-2 mb-2">
												<h3 className="text-sm font-semibold ">
													Not on a LinkedIn Page
												</h3>
											</div>
											<p className="text-xs  mb-3">
												Add a company by domain from this page, or navigate to a
												LinkedIn profile or company page to capture it.
											</p>
											<Button
												onClick={checkCurrentTab}
												className="w-full"
												variant="outline"
												size="sm"
											>
												Check for Company Domain
											</Button>
										</>
									)}
								</div>
							)}
						</section>
					)}

					{recentCaptures.length > 0 && (
						<section className="mb-5">
							<p className="text-sm font-medium">Recently Added</p>
							<ul className="list-none p-0 mt-2">
								{recentCaptures.map((capture) => (
									<li key={capture.twentyId} className="mb-2 list-none">
										<button
											type="button"
											className="flex w-full items-center gap-3 px-3 py-2.5 bg-sidebar rounded-lg cursor-pointer transition-colors hover:bg-sidebar/80 text-left"
											onClick={() => openRecord(capture)}
										>
											<Avatar className="size-8 shrink-0">
												<AvatarFallback>
													{capture.type === "person" ? (
														<User className="size-4" />
													) : (
														<Building2 className="size-4" />
													)}
												</AvatarFallback>
											</Avatar>
											<div className="flex-1 min-w-0">
												<span className="block text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">
													{capture.name}
												</span>
												<span className="text-xs ">
													{formatDate(capture.capturedAt)}
												</span>
											</div>
											<Link className="size-3" />
										</button>
									</li>
								))}
							</ul>
						</section>
					)}

					<footer className="mt-auto pt-4 text-center text-[11px] text-muted-foreground">
						Version {extensionVersion}
					</footer>
				</main>
			)}
		</div>
	);
}

function hasIncompleteHttpProtocol(value: string): boolean {
	return /^https?:\/*$/i.test(value) || /^https?:\/(?!\/)/i.test(value);
}

export function parseTwentyUrl(twentyUrl: string): URL | null {
	const normalized = twentyUrl.trim();
	if (!normalized || hasIncompleteHttpProtocol(normalized)) {
		return null;
	}

	const withProtocol = /^https?:\/\//i.test(normalized)
		? normalized
		: `https://${normalized}`;

	try {
		const parsed = new URL(withProtocol);
		if (
			(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
			!parsed.hostname
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function isOfficialTwentyCloudHost(hostname: string): boolean {
	return (
		hostname === "twenty.com" ||
		hostname === "www.twenty.com" ||
		hostname === "app.twenty.com" ||
		hostname === "api.twenty.com"
	);
}

export function normalizeTwentyUrl(twentyUrl: string): string | null {
	const parsed = parseTwentyUrl(twentyUrl);
	if (!parsed) {
		return null;
	}

	const normalizedHost = parsed.hostname.toLowerCase();
	if (normalizedHost === "twenty.com" || normalizedHost === "www.twenty.com") {
		return `${parsed.protocol}//app.twenty.com`;
	}

	const normalizedPath =
		parsed.pathname && parsed.pathname !== "/"
			? parsed.pathname.replace(/\/$/, "")
			: "";
	return `${parsed.protocol}//${parsed.hostname}${normalizedPath}`;
}

export function resolveTwentyApiBaseUrl(twentyUrl: string): string | null {
	const parsed = parseTwentyUrl(twentyUrl);
	if (!parsed) {
		return null;
	}

	const hostname = parsed.hostname.toLowerCase();
	if (isOfficialTwentyCloudHost(hostname)) {
		return `${parsed.protocol}//api.twenty.com`;
	}

	const normalizedPath =
		parsed.pathname && parsed.pathname !== "/"
			? parsed.pathname.replace(/\/$/, "")
			: "";
	return `${parsed.origin}${normalizedPath}`;
}

export function getTwentyOriginPatterns(twentyUrl: string): string[] {
	const parsed = parseTwentyUrl(twentyUrl);
	if (!parsed) {
		return [];
	}

	const protocol = parsed.protocol;
	const hostname = parsed.hostname.toLowerCase();
	const hostnames = new Set<string>([hostname]);

	if (hostname.startsWith("www.")) {
		hostnames.add(hostname.replace(/^www\./, ""));
	} else {
		hostnames.add(`www.${hostname}`);
	}

	if (isOfficialTwentyCloudHost(hostname)) {
		hostnames.add("twenty.com");
		hostnames.add("www.twenty.com");
		hostnames.add("app.twenty.com");
		hostnames.add("api.twenty.com");
	}

	return Array.from(hostnames).map((host) => `${protocol}//${host}/*`);
}

export function getTwentyCookieUrls(twentyUrl: string): string[] {
	return getTwentyOriginPatterns(twentyUrl).map((origin) =>
		origin.replace(/\/\*$/, ""),
	);
}

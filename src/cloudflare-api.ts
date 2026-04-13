import { CloudflareApiError } from "./errors.js";

type CloudflareResponseEnvelope<T> = {
	success: boolean;
	result: T;
	errors?: Array<{ code?: number; message?: string }>;
};

function describeFailure(envelope: Partial<CloudflareResponseEnvelope<unknown>> | undefined, fallback: string): string {
	const message = envelope?.errors
		?.map((entry) => entry.message)
		.filter(Boolean)
		.join("; ");
	return message || fallback;
}

export function isCloudflareNotFoundError(error: unknown): boolean {
	return error instanceof CloudflareApiError && error.status === 404;
}

export async function requestCloudflare<T>(params: {
	url: string;
	apiToken: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}): Promise<T> {
	const headers = new Headers(params.headers);
	headers.set("Authorization", `Bearer ${params.apiToken}`);
	if (!headers.has("Content-Type") && params.body) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(params.url, {
		method: params.method ?? (params.body ? "POST" : "GET"),
		headers,
		body: params.body,
	});

	const rawText = await response.text();
	const parsed = rawText ? (JSON.parse(rawText) as CloudflareResponseEnvelope<T>) : undefined;
	if (!response.ok) {
		throw new CloudflareApiError(describeFailure(parsed, `Cloudflare request failed with ${response.status}.`), response.status, parsed);
	}
	if (!parsed?.success) {
		throw new CloudflareApiError(describeFailure(parsed, "Cloudflare request failed."), response.status, parsed);
	}

	return parsed.result;
}

import { CloudflareApiError } from "./errors.js";

type CloudflareResponseEnvelope<T> = {
	success: boolean;
	result: T;
	errors?: Array<{ code?: number; message?: string }>;
};

type ResponseMode = "auto" | "envelope";

function describeFailure(envelope: Partial<CloudflareResponseEnvelope<unknown>> | undefined, fallback: string): string {
	const message = envelope?.errors
		?.map((entry) => entry.message)
		.filter(Boolean)
		.join("; ");
	return message || fallback;
}

function isResponseEnvelope<T>(value: unknown): value is Partial<CloudflareResponseEnvelope<T>> & { success: boolean } {
	return value !== null && typeof value === "object" && "success" in value;
}

function parseResponseBody(rawText: string): unknown {
	if (!rawText) {
		return undefined;
	}
	return JSON.parse(rawText) as unknown;
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
	responseMode?: ResponseMode;
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
	const parsed = parseResponseBody(rawText);
	if (!response.ok) {
		throw new CloudflareApiError(
			describeFailure(isResponseEnvelope(parsed) ? parsed : undefined, `Cloudflare request failed with ${response.status}.`),
			response.status,
			parsed,
		);
	}

	if (isResponseEnvelope<T>(parsed)) {
		if (!parsed.success) {
			throw new CloudflareApiError(describeFailure(parsed, "Cloudflare request failed."), response.status, parsed);
		}
		return parsed.result as T;
	}

	if ((params.responseMode ?? "envelope") === "auto") {
		return parsed as T;
	}

	throw new CloudflareApiError("Cloudflare response did not include the expected success/result envelope.", response.status, parsed);
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareMemoryService } from "../src/service.js";
import type { ResolvedPluginConfig } from "../src/types.js";

const baseConfig: ResolvedPluginConfig = {
	accountId: "account",
	apiToken: "token",
	apiBaseUrl: "https://api.cloudflare.com/client/v4",
	workersAiBaseUrl: "https://api.cloudflare.com/client/v4/accounts/account/ai/v1",
	vectorizeBaseUrl: "https://api.cloudflare.com/client/v4/accounts/account/vectorize/v2/indexes/memory",
	indexName: "memory",
	topK: 5,
	minScore: 0,
	metric: "cosine",
	model: "@cf/baai/bge-base-en-v1.5",
	storageMode: "vectorize-inline",
	companionStorePath: ".openclaw/memory-cloudflare-vectorize/companion-store.json",
	inlineTextMaxBytes: 6000,
	metadataIndexedFields: [],
	createIndex: {
		description: "index",
		metric: "cosine",
	},
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("doctor", () => {
	it("reports a metadata warning when no indexed fields are configured", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				text: async () =>
					JSON.stringify({
						success: true,
						result: {
							config: {
								dimensions: 3,
								metric: "cosine",
							},
						},
					}),
			})
			.mockResolvedValueOnce({
				ok: true,
				text: async () =>
					JSON.stringify({
						success: true,
						result: {
							data: [{ index: 0, embedding: [1, 2, 3] }],
						},
					}),
			});
		vi.stubGlobal("fetch", fetchMock);

		const service = new CloudflareMemoryService(baseConfig, {} as never);
		const report = await service.doctor({ createIndexIfMissing: false });

		expect(report.ok).toBe(true);
		expect(report.checks.find((check) => check.name === "metadata-filters")?.status).toBe("warn");
	});
});

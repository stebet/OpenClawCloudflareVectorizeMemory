import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkersAiEmbeddingsClient } from "../src/embeddings-client.js";
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

describe("WorkersAiEmbeddingsClient", () => {
	it("posts to the OpenAI-compatible embeddings endpoint and accepts raw OpenAI-style responses", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({
					data: [
						{ index: 1, embedding: [3, 4] },
						{ index: 0, embedding: [1, 2] },
					],
				}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new WorkersAiEmbeddingsClient(baseConfig);
		const embeddings = await client.embedBatch(["first", "second"]);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/accounts/account/ai/v1/embeddings",
			expect.objectContaining({
				method: "POST",
			}),
		);
		expect(embeddings).toEqual([
			[1, 2],
			[3, 4],
		]);
	});

	it("accepts Cloudflare envelope responses", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({
					success: true,
					result: {
						data: [
							{ index: 1, embedding: [3, 4] },
							{ index: 0, embedding: [1, 2] },
						],
					},
				}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new WorkersAiEmbeddingsClient(baseConfig);
		const embeddings = await client.embedBatch(["first", "second"]);

		expect(embeddings).toEqual([
			[1, 2],
			[3, 4],
		]);
	});

	it("accepts raw Workers AI embedding responses", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({
					shape: [2, 2],
					data: [
						[1, 2],
						[3, 4],
					],
				}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new WorkersAiEmbeddingsClient(baseConfig);
		const embeddings = await client.embedBatch(["first", "second"]);

		expect(embeddings).toEqual([
			[1, 2],
			[3, 4],
		]);
	});
});

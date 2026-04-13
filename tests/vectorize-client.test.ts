import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPluginConfig } from "../src/types.js";
import { VectorizeClient } from "../src/vectorize-client.js";

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

describe("VectorizeClient", () => {
	it("sends namespace-aware query requests", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({
					success: true,
					result: {
						matches: [{ id: "main::record-1", namespace: "main", score: 0.9, metadata: {} }],
					},
				}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new VectorizeClient(baseConfig);
		const matches = await client.query({
			vector: [0.1, 0.2],
			namespace: "main",
			filter: { topic: "testing" },
		});

		expect(matches).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/accounts/account/vectorize/v2/indexes/memory/query",
			expect.objectContaining({
				body: JSON.stringify({
					vector: [0.1, 0.2],
					topK: 5,
					filter: { topic: "testing" },
					namespace: "main",
					returnValues: false,
				}),
			}),
		);
	});

	it("serializes upserts as ndjson", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({
					success: true,
					result: { mutationId: "mutation-1" },
				}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new VectorizeClient(baseConfig);
		const mutationId = await client.upsert([
			{
				id: "main::record-1",
				namespace: "main",
				values: [1, 2],
				metadata: { tag: "test" },
			},
		]);

		expect(mutationId).toBe("mutation-1");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/accounts/account/vectorize/v2/indexes/memory/upsert",
			expect.objectContaining({
				body: '{"id":"main::record-1","namespace":"main","values":[1,2],"metadata":{"tag":"test"}}',
				headers: expect.any(Headers),
			}),
		);
	});

	it("deletes an index with the index endpoint", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({
					success: true,
					result: {},
				}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const client = new VectorizeClient(baseConfig);
		await client.deleteIndex();

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/accounts/account/vectorize/v2/indexes/memory",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
	});
});

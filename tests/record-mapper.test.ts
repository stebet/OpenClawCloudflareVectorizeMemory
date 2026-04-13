import { describe, expect, it } from "vitest";
import { buildVectorId, mapRecordForUpsert } from "../src/record-mapper.js";
import type { ResolvedPluginConfig } from "../src/types.js";

const inlineConfig: ResolvedPluginConfig = {
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

describe("mapRecordForUpsert", () => {
	it("stores text inline in vectorize-inline mode", () => {
		const mapped = mapRecordForUpsert({
			input: {
				id: "record-1",
				text: "Remember this",
				metadata: { topic: "testing" },
			},
			namespace: "main",
			embedding: [1, 2, 3],
			config: inlineConfig,
		});

		expect(mapped.vector.metadata?.oc_text).toBe("Remember this");
		expect(mapped.companionRecord).toBeUndefined();
	});

	it("creates a companion record in companion-store mode", () => {
		const mapped = mapRecordForUpsert({
			input: {
				id: "record-2",
				text: "Store this externally",
			},
			namespace: "agent-main",
			embedding: [1, 2, 3],
			config: {
				...inlineConfig,
				storageMode: "companion-store",
			},
		});

		expect(mapped.vector.metadata?.oc_pointer).toBe("agent-main/record-2.md");
		expect(mapped.companionRecord?.text).toBe("Store this externally");
	});

	it("hashes long vector ids to stay within Vectorize limits", () => {
		const vectorId = buildVectorId("cf-memory-test-50926990-8d16-4b7a-acf1-53ea774d7141", "cf-memory-test-cf5e9ef0-d450-40c9-8f24-c859d1624a13");

		expect(Buffer.byteLength(vectorId, "utf8")).toBeLessThanOrEqual(64);
		expect(vectorId).toMatch(/^cfm_[0-9a-f]{48}$/);
	});
});

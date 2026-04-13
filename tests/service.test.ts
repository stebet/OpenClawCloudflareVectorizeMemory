import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareApiError } from "../src/errors.js";
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
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("CloudflareMemoryService", () => {
	it("initializes a missing index with the live embedding dimensions", async () => {
		const service = new CloudflareMemoryService(
			{
				...baseConfig,
				createIndex: {
					...baseConfig.createIndex,
					dimensions: 384,
				},
			},
			{} as never,
		);
		vi.spyOn(service.embeddings, "probeDimensions").mockResolvedValue(768);
		vi.spyOn(service.vectorize, "describeIndex").mockRejectedValue(new CloudflareApiError("not found", 404));
		const createIndex = vi.spyOn(service.vectorize, "createIndex").mockResolvedValue({
			config: {
				dimensions: 768,
				metric: "cosine",
			},
		});

		const report = await service.initializeIndex();

		expect(createIndex).toHaveBeenCalledWith(768);
		expect(report.ok).toBe(true);
		expect(report.created).toBe(true);
		expect(report.recreated).toBe(false);
		expect(report.checks.find((check) => check.name === "create-index-dimensions")?.status).toBe("warn");
	});

	it("recreates an existing index when its dimensions do not match the embedding model", async () => {
		const service = new CloudflareMemoryService(baseConfig, {} as never);
		vi.spyOn(service.embeddings, "probeDimensions").mockResolvedValue(768);
		vi.spyOn(service.vectorize, "describeIndex").mockResolvedValue({
			config: {
				dimensions: 384,
				metric: "cosine",
			},
		});
		const deleteIndex = vi.spyOn(service.vectorize, "deleteIndex").mockResolvedValue();
		const createIndex = vi.spyOn(service.vectorize, "createIndex").mockResolvedValue({
			config: {
				dimensions: 768,
				metric: "cosine",
			},
		});

		const report = await service.initializeIndex();

		expect(deleteIndex).toHaveBeenCalledTimes(1);
		expect(createIndex).toHaveBeenCalledWith(768);
		expect(report.ok).toBe(true);
		expect(report.recreated).toBe(true);
		expect(report.checks.find((check) => check.name === "vectorize-index")?.message).toContain("Recreated");
	});

	it("runs a smoke test with probe upsert, search, and cleanup", async () => {
		const service = new CloudflareMemoryService(baseConfig, {} as never);
		vi.spyOn(service, "inspectEmbeddingDimensions").mockResolvedValue({
			embeddingDimensions: 768,
			configuredDimensions: undefined,
			configuredDimensionsMatchModel: true,
			targetDimensions: 768,
		});
		vi.spyOn(service, "describeIndexIfExists").mockResolvedValue({
			config: {
				dimensions: 768,
				metric: "cosine",
			},
		});

		let capturedId = "";
		let capturedNamespace = "";
		vi.spyOn(service, "upsert").mockImplementation(async ({ input }) => {
			capturedId = input.id ?? "";
			capturedNamespace = input.namespace ?? "";
			return {
				logicalId: capturedId,
				vectorId: `${capturedNamespace}::${capturedId}`,
				namespace: capturedNamespace,
				text: input.text,
				metadata: input.metadata ?? {},
				path: `${capturedNamespace}/${capturedId}.md`,
				source: input.source,
			};
		});

		let searchCalls = 0;
		vi.spyOn(service, "search").mockImplementation(async () => {
			searchCalls += 1;
			if (searchCalls < 2) {
				return [];
			}
			return [
				{
					logicalId: capturedId,
					vectorId: `${capturedNamespace}::${capturedId}`,
					namespace: capturedNamespace,
					text: `OpenClaw Cloudflare memory smoke test ${capturedId}`,
					metadata: {},
					path: `${capturedNamespace}/${capturedId}.md`,
					score: 0.99,
				},
			];
		});
		const deleteRecord = vi.spyOn(service, "delete").mockResolvedValue("mutation-1");

		const report = await service.runSmokeTest({
			timeoutMs: 10,
			pollIntervalMs: 1,
		});

		expect(report.ok).toBe(true);
		expect(report.namespace).toBe(capturedNamespace);
		expect(report.logicalId).toBe(capturedId);
		expect(deleteRecord).toHaveBeenCalledWith({
			id: capturedId,
			namespace: capturedNamespace,
		});
		expect(report.checks.find((check) => check.name === "probe-search")?.status).toBe("pass");
		expect(report.checks.find((check) => check.name === "probe-cleanup")?.status).toBe("pass");
	});
});

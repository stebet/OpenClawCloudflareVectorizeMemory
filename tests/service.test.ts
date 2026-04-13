import { afterEach, describe, expect, it, vi } from "vitest";
import { RESERVED_METADATA_KEYS } from "../src/constants.js";
import { CloudflareApiError } from "../src/errors.js";
import { buildVectorId } from "../src/record-mapper.js";
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
		vi.spyOn(service, "get").mockImplementation(async () => {
			if (!capturedId || !capturedNamespace) {
				return null;
			}
			return {
				logicalId: capturedId,
				vectorId: `${capturedNamespace}::${capturedId}`,
				namespace: capturedNamespace,
				text: `OpenClaw Cloudflare memory smoke test ${capturedId}`,
				metadata: {},
				path: `${capturedNamespace}/${capturedId}.md`,
			};
		});
		const embedQuery = vi.spyOn(service.embeddings, "embedQuery").mockResolvedValue([1, 2, 3]);
		let searchCalls = 0;
		vi.spyOn(service.vectorize, "query").mockImplementation(async ({ namespace }) => {
			searchCalls += 1;
			expect(namespace).toBe(capturedNamespace);
			if (searchCalls < 2) {
				return [];
			}
			return [
				{
					id: `${capturedNamespace}::${capturedId}`,
					namespace: capturedNamespace,
					score: 0.99,
					metadata: {
						[RESERVED_METADATA_KEYS.logicalId]: capturedId,
						[RESERVED_METADATA_KEYS.namespace]: capturedNamespace,
						[RESERVED_METADATA_KEYS.text]: `OpenClaw Cloudflare memory smoke test ${capturedId}`,
					},
				},
			];
		});
		const deleteRecord = vi.spyOn(service, "delete").mockResolvedValue("mutation-1");

		const report = await service.runSmokeTest({
			timeoutMs: 50,
			pollIntervalMs: 1,
		});

		expect(report.ok).toBe(true);
		expect(report.namespace).toBe(capturedNamespace);
		expect(report.logicalId).toBe(capturedId);
		expect(deleteRecord).toHaveBeenCalledWith({
			id: capturedId,
			namespace: capturedNamespace,
		});
		expect(report.checks.find((check) => check.name === "probe-get")?.status).toBe("pass");
		expect(report.checks.find((check) => check.name === "probe-search")?.status).toBe("pass");
		expect(report.checks.find((check) => check.name === "probe-cleanup")?.status).toBe("pass");
		expect(embedQuery).toHaveBeenCalledTimes(1);
		expect(searchCalls).toBe(2);
	});

	it("falls back to the upsert input when get-by-id omits inline metadata", async () => {
		const service = new CloudflareMemoryService(baseConfig, {} as never);
		vi.spyOn(service.embeddings, "embedQuery").mockResolvedValue([1, 2, 3]);
		vi.spyOn(service.vectorize, "upsert").mockResolvedValue("mutation-1");
		vi.spyOn(service, "get").mockResolvedValue({
			logicalId: "publish-check",
			vectorId: "cfm_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbe",
			namespace: "release",
			text: "",
			metadata: {},
			path: "release/publish-check.md",
		});

		const result = await service.upsert({
			input: {
				id: "publish-check",
				namespace: "release",
				title: "Publish integration check",
				text: "Verify Cloudflare memory publish checks.",
				source: "integration-test",
				metadata: {
					topic: "release",
					suite: "live",
				},
			},
		});

		expect(result).toMatchObject({
			logicalId: "publish-check",
			namespace: "release",
			title: "Publish integration check",
			text: "Verify Cloudflare memory publish checks.",
			source: "integration-test",
			metadata: {
				topic: "release",
				suite: "live",
			},
			mutationId: "mutation-1",
		});
	});

	it("keeps implicit and explicit namespaces aligned when Vectorize omits match namespaces", async () => {
		const service = new CloudflareMemoryService(baseConfig, {} as never);
		const logicalId = "publish-check";
		const text = "Verify Cloudflare memory publish checks.";
		const sessionKey = "session-1";
		let storedVector:
			| {
					id: string;
					namespace?: string;
					metadata?: Record<string, string | number | boolean>;
			  }
			| undefined;
		const queriedNamespaces: string[] = [];
		const deletedVectorIds: string[] = [];

		vi.spyOn(service.embeddings, "embedQuery").mockResolvedValue([1, 2, 3]);
		vi.spyOn(service.vectorize, "upsert").mockImplementation(async ([vector]) => {
			storedVector = vector;
			return "mutation-1";
		});
		vi.spyOn(service.vectorize, "getByIds").mockImplementation(async (ids) => [
			{
				id: ids[0],
				metadata: storedVector?.metadata,
			},
		]);
		vi.spyOn(service.vectorize, "query").mockImplementation(async ({ namespace }) => {
			queriedNamespaces.push(namespace ?? "");
			return storedVector
				? [
						{
							id: storedVector.id,
							score: 0.99,
							metadata: storedVector.metadata,
						},
					]
				: [];
		});
		vi.spyOn(service.vectorize, "deleteByIds").mockImplementation(async (ids) => {
			deletedVectorIds.push(...ids);
			return "mutation-delete";
		});

		const upserted = await service.upsert({
			input: {
				id: logicalId,
				text,
			},
			sessionKey,
		});
		const implicitGet = await service.get({
			id: logicalId,
			sessionKey,
		});
		const explicitGet = await service.get({
			id: logicalId,
			namespace: "agent-main",
			sessionKey,
		});
		const implicitSearch = await service.search({
			query: text,
			sessionKey,
		});
		const explicitSearch = await service.search({
			query: text,
			namespace: "agent-main",
			sessionKey,
		});
		await service.delete({
			id: logicalId,
			sessionKey,
		});
		await service.delete({
			id: logicalId,
			namespace: "agent-main",
			sessionKey,
		});

		expect(upserted.namespace).toBe("agent-main");
		expect(implicitGet?.namespace).toBe("agent-main");
		expect(explicitGet?.namespace).toBe("agent-main");
		expect(implicitSearch.map((record) => record.namespace)).toEqual(["agent-main"]);
		expect(explicitSearch.map((record) => record.namespace)).toEqual(["agent-main"]);
		expect(queriedNamespaces).toEqual(["agent-main", "agent-main"]);
		expect(deletedVectorIds).toEqual([buildVectorId("agent-main", logicalId), buildVectorId("agent-main", logicalId)]);
	});
});

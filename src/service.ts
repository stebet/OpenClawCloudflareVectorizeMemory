import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { isCloudflareNotFoundError } from "./cloudflare-api.js";
import { CompanionStore } from "./companion-store.js";
import { runDoctor } from "./doctor.js";
import { WorkersAiEmbeddingsClient } from "./embeddings-client.js";
import { sanitizeNamespace, resolveDefaultNamespace } from "./namespace.js";
import { buildVectorId, hydrateInlineRecord, mapRecordForUpsert } from "./record-mapper.js";
import type {
	CompanionRecord,
	DoctorCheck,
	DoctorReport,
	EmbeddingDimensionsInspection,
	HydratedMemoryRecord,
	IndexInitializationReport,
	MemoryRecordInput,
	MetadataFilter,
	ResolvedPluginConfig,
	SmokeTestReport,
	UpsertedMemoryRecord,
	VectorizeIndexDescription,
} from "./types.js";
import { VectorizeClient } from "./vectorize-client.js";

const SMOKE_TEST_TIMEOUT_MS = 30_000;
const SMOKE_TEST_POLL_INTERVAL_MS = 1_000;

export class CloudflareMemoryService {
	readonly embeddings: WorkersAiEmbeddingsClient;
	readonly vectorize: VectorizeClient;
	readonly companionStore: CompanionStore;

	constructor(
		readonly config: ResolvedPluginConfig,
		readonly openClawConfig: OpenClawConfig,
	) {
		this.embeddings = new WorkersAiEmbeddingsClient(config);
		this.vectorize = new VectorizeClient(config);
		this.companionStore = new CompanionStore(config.companionStorePath);
	}

	resolveNamespace(params: { namespace?: string; sessionKey?: string; agentId?: string; workspaceDir?: string }): string {
		return resolveDefaultNamespace({
			fixedNamespace: params.namespace ?? this.config.fixedNamespace,
			sessionKey: params.sessionKey,
			agentId: params.agentId,
			workspaceDir: params.workspaceDir,
		});
	}

	async search(params: {
		query: string;
		namespace?: string;
		maxResults?: number;
		minScore?: number;
		filter?: MetadataFilter;
		sessionKey?: string;
		agentId?: string;
		workspaceDir?: string;
	}): Promise<Array<HydratedMemoryRecord & { score: number }>> {
		const namespace = this.resolveNamespace(params);
		const vector = await this.embeddings.embedQuery(params.query);
		const matches = await this.vectorize.query({
			vector,
			namespace,
			topK: params.maxResults ?? this.config.topK,
			filter: params.filter,
		});

		const hydrated = await Promise.all(
			matches.map(async (match) => {
				const base = hydrateInlineRecord(match);
				const text = base.text ?? (await this.companionStore.get(base.namespace, base.logicalId))?.text ?? "";
				return {
					...base,
					text,
					score: match.score ?? 0,
				};
			}),
		);

		return hydrated.filter((record) => record.score >= (params.minScore ?? this.config.minScore));
	}

	async get(params: { id: string; namespace?: string; sessionKey?: string; agentId?: string; workspaceDir?: string }): Promise<HydratedMemoryRecord | null> {
		const namespace = this.resolveNamespace(params);
		const vectorId = buildVectorId(namespace, params.id);
		const [match] = await this.vectorize.getByIds([vectorId]);
		if (!match) {
			return null;
		}
		const base = hydrateInlineRecord(match);
		const companion = await this.companionStore.get(base.namespace, base.logicalId);
		return {
			...base,
			text: base.text ?? companion?.text ?? "",
		};
	}

	async upsert(params: { input: MemoryRecordInput; sessionKey?: string; agentId?: string; workspaceDir?: string }): Promise<UpsertedMemoryRecord> {
		const namespace = this.resolveNamespace({
			namespace: params.input.namespace,
			sessionKey: params.sessionKey,
			agentId: params.agentId,
			workspaceDir: params.workspaceDir,
		});
		const embedding = await this.embeddings.embedQuery(params.input.text);
		const mapped = mapRecordForUpsert({
			input: params.input,
			namespace,
			embedding,
			config: this.config,
		});

		if (mapped.companionRecord) {
			await this.companionStore.upsert(mapped.companionRecord);
		}

		const mutationId = await this.vectorize.upsert([mapped.vector]);
		const hydrated = await this.get({
			id: mapped.logicalId,
			namespace,
		});
		const fallback =
			mapped.companionRecord === undefined
				? this.fromInlineFallback(mapped.vector)
				: this.fromCompanionFallback(mapped.companionRecord, mapped.logicalId, namespace, mapped.path);
		const resolved = hydrated
			? {
					...fallback,
					...hydrated,
					title: hydrated.title ?? fallback.title,
					text: hydrated.text || fallback.text,
					metadata: Object.keys(hydrated.metadata).length > 0 ? hydrated.metadata : fallback.metadata,
					source: hydrated.source ?? fallback.source,
					createdAt: hydrated.createdAt ?? fallback.createdAt,
					updatedAt: hydrated.updatedAt ?? fallback.updatedAt,
				}
			: fallback;

		return {
			...resolved,
			mutationId,
		};
	}

	async delete(params: { id: string; namespace?: string; sessionKey?: string; agentId?: string; workspaceDir?: string }): Promise<string | undefined> {
		const namespace = this.resolveNamespace(params);
		await this.companionStore.delete(namespace, params.id);
		return this.vectorize.deleteByIds([buildVectorId(namespace, params.id)]);
	}

	async doctor(options: { createIndexIfMissing?: boolean }): Promise<DoctorReport> {
		return runDoctor({
			service: this,
			createIndexIfMissing: options.createIndexIfMissing ?? false,
		});
	}

	async inspectEmbeddingDimensions(): Promise<EmbeddingDimensionsInspection> {
		const embeddingDimensions = await this.embeddings.probeDimensions();
		const configuredDimensions = this.config.createIndex.dimensions;
		return {
			embeddingDimensions,
			configuredDimensions,
			configuredDimensionsMatchModel: configuredDimensions === undefined || configuredDimensions === embeddingDimensions,
			targetDimensions: embeddingDimensions,
		};
	}

	async describeIndexIfExists(): Promise<VectorizeIndexDescription | null> {
		try {
			return await this.vectorize.describeIndex();
		} catch (error) {
			if (isCloudflareNotFoundError(error)) {
				return null;
			}
			throw error;
		}
	}

	async initializeIndex(options?: { recreateIfDimensionMismatch?: boolean }): Promise<IndexInitializationReport> {
		const recreateIfDimensionMismatch = options?.recreateIfDimensionMismatch ?? true;
		const checks: DoctorCheck[] = [];
		checks.push({
			name: "credentials",
			status: "pass",
			message: `Using Cloudflare account ${this.config.accountId} and Vectorize index ${this.config.indexName}.`,
		});

		const embedding = await this.inspectEmbeddingDimensions();
		checks.push({
			name: "workers-ai-embeddings",
			status: "pass",
			message: `Workers AI model ${this.config.model} returned ${embedding.embeddingDimensions} dimensions.`,
		});
		if (embedding.configuredDimensions !== undefined) {
			checks.push({
				name: "create-index-dimensions",
				status: embedding.configuredDimensionsMatchModel ? "pass" : "warn",
				message: embedding.configuredDimensionsMatchModel
					? `Configured createIndex.dimensions matches the embedding model (${embedding.embeddingDimensions}).`
					: `Configured createIndex.dimensions (${embedding.configuredDimensions}) does not match the embedding model (${embedding.embeddingDimensions}). Using the live embedding dimensions for initialization.`,
			});
		}

		const existingIndex = await this.describeIndexIfExists();
		let created = false;
		let recreated = false;
		let indexDimensions = existingIndex?.config.dimensions;

		if (!existingIndex) {
			const createdIndex = await this.vectorize.createIndex(embedding.targetDimensions);
			created = true;
			indexDimensions = createdIndex.config.dimensions;
			checks.push({
				name: "vectorize-index",
				status: "pass",
				message: `Created Vectorize index "${this.config.indexName}" with ${indexDimensions} dimensions.`,
			});
		} else if (existingIndex.config.dimensions === embedding.targetDimensions) {
			checks.push({
				name: "vectorize-index",
				status: "pass",
				message: `Vectorize index "${this.config.indexName}" already uses ${existingIndex.config.dimensions} dimensions.`,
			});
		} else if (!recreateIfDimensionMismatch) {
			checks.push({
				name: "vectorize-index",
				status: "fail",
				message: `Vectorize index "${this.config.indexName}" uses ${existingIndex.config.dimensions} dimensions, but the embedding model requires ${embedding.targetDimensions}. Recreate the index or rerun init with recreation enabled.`,
			});
		} else {
			await this.vectorize.deleteIndex();
			const recreatedIndex = await this.vectorize.createIndex(embedding.targetDimensions);
			recreated = true;
			indexDimensions = recreatedIndex.config.dimensions;
			checks.push({
				name: "vectorize-index",
				status: "pass",
				message: `Recreated Vectorize index "${this.config.indexName}" from ${existingIndex.config.dimensions} to ${indexDimensions} dimensions.`,
			});
		}

		checks.push({
			name: "dimension-match",
			status: indexDimensions === embedding.embeddingDimensions ? "pass" : "fail",
			message:
				indexDimensions === embedding.embeddingDimensions
					? "Embedding dimensions match the Vectorize index."
					: `Embedding dimensions (${embedding.embeddingDimensions}) do not match the Vectorize index dimensions (${indexDimensions ?? "unknown"}).`,
		});
		checks.push({
			name: "metadata-filters",
			status: this.config.metadataIndexedFields.length > 0 ? "pass" : "warn",
			message:
				this.config.metadataIndexedFields.length > 0
					? `Configured metadata-index guidance for: ${this.config.metadataIndexedFields.join(", ")}.`
					: "No metadataIndexedFields configured. Add metadata indexes in Cloudflare before relying on filter-heavy queries.",
		});

		return {
			ok: checks.every((check) => check.status !== "fail"),
			checks,
			created,
			recreated,
			embeddingDimensions: embedding.embeddingDimensions,
			indexDimensions,
		};
	}

	async runSmokeTest(options?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<SmokeTestReport> {
		const checks: DoctorCheck[] = [];
		checks.push({
			name: "credentials",
			status: "pass",
			message: `Using Cloudflare account ${this.config.accountId} and Vectorize index ${this.config.indexName}.`,
		});

		const embedding = await this.inspectEmbeddingDimensions();
		checks.push({
			name: "workers-ai-embeddings",
			status: "pass",
			message: `Workers AI model ${this.config.model} returned ${embedding.embeddingDimensions} dimensions.`,
		});
		if (embedding.configuredDimensions !== undefined) {
			checks.push({
				name: "create-index-dimensions",
				status: embedding.configuredDimensionsMatchModel ? "pass" : "warn",
				message: embedding.configuredDimensionsMatchModel
					? `Configured createIndex.dimensions matches the embedding model (${embedding.embeddingDimensions}).`
					: `Configured createIndex.dimensions (${embedding.configuredDimensions}) does not match the embedding model (${embedding.embeddingDimensions}). Using the live embedding dimensions for validation.`,
			});
		}

		const existingIndex = await this.describeIndexIfExists();
		if (!existingIndex) {
			checks.push({
				name: "vectorize-index",
				status: "fail",
				message: `Vectorize index "${this.config.indexName}" was not found. Run "openclaw cf-memory init" before rerunning this test.`,
			});
			return {
				ok: false,
				checks,
				namespace: "n/a",
				logicalId: "n/a",
			};
		}

		checks.push({
			name: "vectorize-index",
			status: "pass",
			message: `Vectorize index "${this.config.indexName}" is reachable.`,
		});
		if (existingIndex.config.dimensions !== embedding.embeddingDimensions) {
			checks.push({
				name: "dimension-match",
				status: "fail",
				message: `Embedding dimensions (${embedding.embeddingDimensions}) do not match the Vectorize index dimensions (${existingIndex.config.dimensions}). Run "openclaw cf-memory init" to repair the index.`,
			});
			return {
				ok: false,
				checks,
				namespace: "n/a",
				logicalId: "n/a",
			};
		}

		checks.push({
			name: "dimension-match",
			status: "pass",
			message: "Embedding dimensions match the Vectorize index.",
		});

		const namespace = sanitizeNamespace(`cf-memory-test-${randomUUID()}`);
		const logicalId = `cf-memory-test-${randomUUID()}`;
		const probeText = `OpenClaw Cloudflare memory smoke test ${logicalId}`;
		let probeUpserted = false;

		try {
			await this.upsert({
				input: {
					id: logicalId,
					namespace,
					text: probeText,
					source: "cf-memory-test",
					metadata: {
						probe: true,
						probeId: logicalId,
					},
				},
			});
			probeUpserted = true;
			checks.push({
				name: "probe-upsert",
				status: "pass",
				message: `Inserted smoke-test record ${logicalId} in namespace ${namespace}.`,
			});

			const found = await this.waitForSearchHit({
				query: probeText,
				namespace,
				logicalId,
				timeoutMs: options?.timeoutMs ?? SMOKE_TEST_TIMEOUT_MS,
				pollIntervalMs: options?.pollIntervalMs ?? SMOKE_TEST_POLL_INTERVAL_MS,
			});
			checks.push({
				name: "probe-search",
				status: found ? "pass" : "fail",
				message: found
					? "Semantic search returned the smoke-test record."
					: `Semantic search did not return the smoke-test record within ${(options?.timeoutMs ?? SMOKE_TEST_TIMEOUT_MS) / 1000} seconds.`,
			});
		} catch (error) {
			checks.push({
				name: probeUpserted ? "probe-search" : "probe-upsert",
				status: "fail",
				message: error instanceof Error ? error.message : "Smoke test failed with an unknown error.",
			});
		} finally {
			try {
				await this.delete({ id: logicalId, namespace });
				checks.push({
					name: "probe-cleanup",
					status: "pass",
					message: `Deleted smoke-test record ${logicalId}.`,
				});
			} catch (error) {
				checks.push({
					name: "probe-cleanup",
					status: "fail",
					message: error instanceof Error ? error.message : `Failed to delete smoke-test record ${logicalId}.`,
				});
			}
		}

		return {
			ok: checks.every((check) => check.status !== "fail"),
			checks,
			namespace,
			logicalId,
		};
	}

	async ensureIndexExists(createIfMissing: boolean, targetDimensions?: number): Promise<{ created: boolean; dimensions: number }> {
		try {
			const description = await this.vectorize.describeIndex();
			return {
				created: false,
				dimensions: description.config.dimensions,
			};
		} catch (error) {
			if (!createIfMissing || !isCloudflareNotFoundError(error)) {
				throw error;
			}
			const dimensions = targetDimensions ?? (await this.inspectEmbeddingDimensions()).targetDimensions;
			const createdIndex = await this.vectorize.createIndex(dimensions);
			return {
				created: true,
				dimensions: createdIndex.config.dimensions,
			};
		}
	}

	private fromCompanionFallback(companionRecord: CompanionRecord | undefined, logicalId: string, namespace: string, path: string): UpsertedMemoryRecord {
		return {
			logicalId,
			vectorId: buildVectorId(namespace, logicalId),
			namespace,
			title: companionRecord?.title,
			text: companionRecord?.text ?? "",
			metadata: companionRecord?.metadata ?? {},
			source: companionRecord?.source,
			createdAt: companionRecord?.createdAt,
			updatedAt: companionRecord?.updatedAt,
			path,
		};
	}

	private fromInlineFallback(vector: { id: string; namespace?: string; metadata?: Record<string, string | number | boolean> }): UpsertedMemoryRecord {
		const record = hydrateInlineRecord(vector);
		return {
			...record,
			text: record.text ?? "",
		};
	}

	private async waitForSearchHit(params: { query: string; namespace: string; logicalId: string; timeoutMs: number; pollIntervalMs: number }): Promise<boolean> {
		const deadline = Date.now() + params.timeoutMs;
		while (Date.now() <= deadline) {
			const results = await this.search({
				query: params.query,
				namespace: params.namespace,
				maxResults: 5,
				minScore: 0,
			});
			if (results.some((record) => record.logicalId === params.logicalId)) {
				return true;
			}
			if (Date.now() + params.pollIntervalMs > deadline) {
				break;
			}
			await this.pause(params.pollIntervalMs);
		}
		return false;
	}

	private async pause(ms: number): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, ms));
	}
}

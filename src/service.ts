import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { isCloudflareNotFoundError } from "./cloudflare-api.js";
import { CompanionStore } from "./companion-store.js";
import { runDoctor } from "./doctor.js";
import { WorkersAiEmbeddingsClient } from "./embeddings-client.js";
import { resolveDefaultNamespace } from "./namespace.js";
import { hydrateInlineRecord, mapRecordForUpsert } from "./record-mapper.js";
import type {
	CompanionRecord,
	DoctorReport,
	HydratedMemoryRecord,
	MemoryRecordInput,
	MetadataFilter,
	ResolvedPluginConfig,
	UpsertedMemoryRecord,
} from "./types.js";
import { VectorizeClient } from "./vectorize-client.js";

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
		const vectorId = `${namespace}::${params.id}`;
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

		return {
			...(hydrated ?? this.fromCompanionFallback(mapped.companionRecord, mapped.logicalId, namespace, mapped.path)),
			mutationId,
		};
	}

	async delete(params: { id: string; namespace?: string; sessionKey?: string; agentId?: string; workspaceDir?: string }): Promise<string | undefined> {
		const namespace = this.resolveNamespace(params);
		await this.companionStore.delete(namespace, params.id);
		return this.vectorize.deleteByIds([`${namespace}::${params.id}`]);
	}

	async doctor(options: { createIndexIfMissing?: boolean }): Promise<DoctorReport> {
		return runDoctor({
			service: this,
			createIndexIfMissing: options.createIndexIfMissing ?? false,
		});
	}

	async ensureIndexExists(createIfMissing: boolean): Promise<{ created: boolean; dimensions: number }> {
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
			const dimensions = this.config.createIndex.dimensions ?? (await this.embeddings.probeDimensions());
			await this.vectorize.createIndex(dimensions);
			return {
				created: true,
				dimensions,
			};
		}
	}

	private fromCompanionFallback(companionRecord: CompanionRecord | undefined, logicalId: string, namespace: string, path: string): UpsertedMemoryRecord {
		return {
			logicalId,
			vectorId: `${namespace}::${logicalId}`,
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
}

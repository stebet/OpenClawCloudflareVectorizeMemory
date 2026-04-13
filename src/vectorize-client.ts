import { requestCloudflare } from "./cloudflare-api.js";
import type { MetadataFilter, ResolvedPluginConfig, VectorizeIndexDescription, VectorizeQueryMatch, VectorizeVector } from "./types.js";

type MutationResponse = {
	mutationId?: string;
};

type QueryResponse = {
	count?: number;
	matches?: VectorizeQueryMatch[];
};

export class VectorizeClient {
	constructor(private readonly config: ResolvedPluginConfig) {}

	async describeIndex(): Promise<VectorizeIndexDescription> {
		return requestCloudflare<VectorizeIndexDescription>({
			url: this.config.vectorizeBaseUrl,
			apiToken: this.config.apiToken,
			method: "GET",
		});
	}

	async createIndex(dimensions: number, metric = this.config.createIndex.metric): Promise<VectorizeIndexDescription> {
		return requestCloudflare<VectorizeIndexDescription>({
			url: `${this.config.apiBaseUrl}/accounts/${this.config.accountId}/vectorize/v2/indexes`,
			apiToken: this.config.apiToken,
			body: JSON.stringify({
				name: this.config.indexName,
				description: this.config.createIndex.description,
				config: {
					dimensions,
					metric,
				},
			}),
		});
	}

	async deleteIndex(): Promise<void> {
		await requestCloudflare<unknown>({
			url: this.config.vectorizeBaseUrl,
			apiToken: this.config.apiToken,
			method: "DELETE",
		});
	}

	async upsert(vectors: VectorizeVector[]): Promise<string | undefined> {
		const body = vectors.map((vector) => JSON.stringify(vector)).join("\n");
		const result = await requestCloudflare<MutationResponse>({
			url: `${this.config.vectorizeBaseUrl}/upsert`,
			apiToken: this.config.apiToken,
			headers: {
				"Content-Type": "application/x-ndjson",
			},
			body,
		});
		return result.mutationId;
	}

	async query(params: {
		vector: number[];
		namespace?: string;
		topK?: number;
		filter?: MetadataFilter;
		returnValues?: boolean;
	}): Promise<VectorizeQueryMatch[]> {
		const result = await requestCloudflare<QueryResponse>({
			url: `${this.config.vectorizeBaseUrl}/query`,
			apiToken: this.config.apiToken,
			body: JSON.stringify({
				vector: params.vector,
				topK: params.topK ?? this.config.topK,
				filter: params.filter,
				namespace: params.namespace,
				returnValues: params.returnValues ?? false,
				returnMetadata: "all",
			}),
		});
		return result.matches ?? [];
	}

	async getByIds(ids: string[]): Promise<VectorizeQueryMatch[]> {
		if (ids.length === 0) {
			return [];
		}
		return requestCloudflare<VectorizeQueryMatch[]>({
			url: `${this.config.vectorizeBaseUrl}/get_by_ids`,
			apiToken: this.config.apiToken,
			body: JSON.stringify({ ids }),
		});
	}

	async deleteByIds(ids: string[]): Promise<string | undefined> {
		if (ids.length === 0) {
			return undefined;
		}
		const result = await requestCloudflare<MutationResponse>({
			url: `${this.config.vectorizeBaseUrl}/delete_by_ids`,
			apiToken: this.config.apiToken,
			body: JSON.stringify({ ids }),
		});
		return result.mutationId;
	}
}

import { requestCloudflare } from "./cloudflare-api.js";
import type { ResolvedPluginConfig } from "./types.js";

const QUERY_CACHE_LIMIT = 64;

type OpenAiEmbeddingResponse = {
	data: Array<{
		embedding: number[];
		index: number;
	}>;
};

type NativeEmbeddingResponse = {
	data: number[][];
	shape?: number[];
};

type EmbeddingResponse = OpenAiEmbeddingResponse | NativeEmbeddingResponse;

function isOpenAiEmbeddingResponse(response: EmbeddingResponse): response is OpenAiEmbeddingResponse {
	return response.data.every(
		(entry) =>
			Boolean(entry) &&
			typeof entry === "object" &&
			"embedding" in entry &&
			Array.isArray(entry.embedding) &&
			"index" in entry &&
			typeof entry.index === "number",
	);
}

export class WorkersAiEmbeddingsClient {
	private readonly queryCache = new Map<string, Promise<number[]>>();

	constructor(private readonly config: ResolvedPluginConfig) {}

	async embedQuery(text: string): Promise<number[]> {
		const cached = this.queryCache.get(text);
		if (cached) {
			return [...(await cached)];
		}

		const pending = this.embedBatch([text])
			.then(([embedding]) => {
				if (!embedding) {
					throw new Error("Workers AI did not return an embedding.");
				}
				return embedding;
			})
			.catch((error) => {
				this.queryCache.delete(text);
				throw error;
			});
		this.queryCache.set(text, pending);
		if (this.queryCache.size > QUERY_CACHE_LIMIT) {
			const oldestKey = this.queryCache.keys().next().value;
			if (typeof oldestKey === "string") {
				this.queryCache.delete(oldestKey);
			}
		}

		return [...(await pending)];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}
		const response = await requestCloudflare<EmbeddingResponse>({
			url: `${this.config.workersAiBaseUrl}/embeddings`,
			apiToken: this.config.apiToken,
			body: JSON.stringify({
				model: this.config.model,
				input: texts,
			}),
			responseMode: "auto",
		});

		if (isOpenAiEmbeddingResponse(response)) {
			return [...response.data].sort((left, right) => left.index - right.index).map((entry) => entry.embedding);
		}

		return response.data;
	}

	async probeDimensions(): Promise<number> {
		const embedding = await this.embedQuery("openclaw-memory-dimension-probe");
		return embedding.length;
	}
}

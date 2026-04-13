import { requestCloudflare } from "./cloudflare-api.js";
import type { ResolvedPluginConfig } from "./types.js";

type OpenAiEmbeddingResponse = {
	data: Array<{
		embedding: number[];
		index: number;
	}>;
};

export class WorkersAiEmbeddingsClient {
	constructor(private readonly config: ResolvedPluginConfig) {}

	async embedQuery(text: string): Promise<number[]> {
		const [embedding] = await this.embedBatch([text]);
		return embedding;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) {
			return [];
		}
		const response = await requestCloudflare<OpenAiEmbeddingResponse>({
			url: `${this.config.workersAiBaseUrl}/embeddings`,
			apiToken: this.config.apiToken,
			body: JSON.stringify({
				model: this.config.model,
				input: texts,
			}),
		});

		return [...response.data].sort((left, right) => left.index - right.index).map((entry) => entry.embedding);
	}

	async probeDimensions(): Promise<number> {
		const embedding = await this.embedQuery("openclaw-memory-dimension-probe");
		return embedding.length;
	}
}

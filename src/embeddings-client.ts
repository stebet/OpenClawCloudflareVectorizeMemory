import { requestCloudflare } from "./cloudflare-api.js";
import type { ResolvedPluginConfig } from "./types.js";

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
	constructor(private readonly config: ResolvedPluginConfig) {}

	async embedQuery(text: string): Promise<number[]> {
		const [embedding] = await this.embedBatch([text]);
		return embedding;
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

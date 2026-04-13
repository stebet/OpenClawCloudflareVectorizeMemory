import type {
	MemoryEmbeddingProbeResult,
	MemoryProviderStatus,
	MemorySearchManager,
	MemorySearchResult,
} from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import { buildSnippet, parseVirtualPath } from "./record-mapper.js";
import type { CloudflareMemoryService } from "./service.js";

export class CloudflareMemorySearchManager implements MemorySearchManager {
	constructor(
		private readonly service: CloudflareMemoryService,
		private readonly agentId: string,
	) {}

	async search(query: string, opts?: { maxResults?: number; minScore?: number; sessionKey?: string }): Promise<MemorySearchResult[]> {
		const records = await this.service.search({
			query,
			maxResults: opts?.maxResults,
			minScore: opts?.minScore,
			sessionKey: opts?.sessionKey,
			agentId: this.agentId,
		});

		return records.map((record) => ({
			path: record.path,
			startLine: 1,
			endLine: Math.max(1, record.text.split(/\r?\n/).length),
			score: record.score,
			snippet: buildSnippet(record.text, query),
			source: "memory",
			citation: record.path,
		}));
	}

	async readFile(params: { relPath: string; from?: number; lines?: number }): Promise<{ text: string; path: string }> {
		const parsed = parseVirtualPath(params.relPath);
		if (!parsed) {
			throw new Error(`Unsupported memory lookup path: ${params.relPath}`);
		}
		const record = await this.service.get({
			id: parsed.logicalId,
			namespace: parsed.namespace,
			agentId: this.agentId,
		});
		if (!record) {
			throw new Error(`Memory record not found for ${params.relPath}`);
		}

		const from = Math.max(1, params.from ?? 1);
		const lines = Math.max(1, params.lines ?? record.text.split(/\r?\n/).length);
		const selected = record.text
			.split(/\r?\n/)
			.slice(from - 1, from - 1 + lines)
			.join("\n");
		return {
			text: selected,
			path: record.path,
		};
	}

	status(): MemoryProviderStatus {
		return {
			backend: "builtin",
			provider: "cloudflare-vectorize",
			model: this.service.config.model,
			workspaceDir: this.service.config.companionStorePath,
			custom: {
				indexName: this.service.config.indexName,
				storageMode: this.service.config.storageMode,
				fixedNamespace: this.service.config.fixedNamespace,
			},
		};
	}

	async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
		try {
			await this.service.embeddings.probeDimensions();
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : "Embedding probe failed.",
			};
		}
	}

	async probeVectorAvailability(): Promise<boolean> {
		try {
			await this.service.vectorize.describeIndex();
			return true;
		} catch {
			return false;
		}
	}

	async close(): Promise<void> {}
}

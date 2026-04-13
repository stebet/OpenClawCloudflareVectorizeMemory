import type { CloudflareMemoryService } from "./service.js";
import type { DoctorCheck, DoctorReport } from "./types.js";

export async function runDoctor(params: { service: CloudflareMemoryService; createIndexIfMissing: boolean }): Promise<DoctorReport> {
	const checks: DoctorCheck[] = [];

	checks.push({
		name: "credentials",
		status: "pass",
		message: `Using Cloudflare account ${params.service.config.accountId} and Vectorize index ${params.service.config.indexName}.`,
	});

	const indexResult = await params.service.ensureIndexExists(params.createIndexIfMissing);
	checks.push({
		name: "vectorize-index",
		status: "pass",
		message: indexResult.created
			? `Created Vectorize index "${params.service.config.indexName}" with ${indexResult.dimensions} dimensions.`
			: `Vectorize index "${params.service.config.indexName}" is reachable.`,
	});

	const embeddingDimensions = await params.service.embeddings.probeDimensions();
	checks.push({
		name: "workers-ai-embeddings",
		status: "pass",
		message: `Workers AI model ${params.service.config.model} returned ${embeddingDimensions} dimensions.`,
	});

	if (embeddingDimensions !== indexResult.dimensions) {
		checks.push({
			name: "dimension-match",
			status: "fail",
			message: `Embedding dimensions (${embeddingDimensions}) do not match the Vectorize index dimensions (${indexResult.dimensions}).`,
		});
	} else {
		checks.push({
			name: "dimension-match",
			status: "pass",
			message: "Embedding dimensions match the Vectorize index.",
		});
	}

	checks.push({
		name: "metadata-filters",
		status: params.service.config.metadataIndexedFields.length > 0 ? "pass" : "warn",
		message:
			params.service.config.metadataIndexedFields.length > 0
				? `Configured metadata-index guidance for: ${params.service.config.metadataIndexedFields.join(", ")}.`
				: "No metadataIndexedFields configured. Add metadata indexes in Cloudflare before relying on filter-heavy queries.",
	});

	const ok = checks.every((check) => check.status !== "fail");
	return { ok, checks };
}

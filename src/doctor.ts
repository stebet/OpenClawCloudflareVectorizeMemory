import type { CloudflareMemoryService } from "./service.js";
import type { DoctorCheck, DoctorReport } from "./types.js";

export async function runDoctor(params: { service: CloudflareMemoryService; createIndexIfMissing: boolean }): Promise<DoctorReport> {
	const checks: DoctorCheck[] = [];

	checks.push({
		name: "credentials",
		status: "pass",
		message: `Using Cloudflare account ${params.service.config.accountId} and Vectorize index ${params.service.config.indexName}.`,
	});

	const embedding = await params.service.inspectEmbeddingDimensions();
	checks.push({
		name: "workers-ai-embeddings",
		status: "pass",
		message: `Workers AI model ${params.service.config.model} returned ${embedding.embeddingDimensions} dimensions.`,
	});
	if (embedding.configuredDimensions !== undefined) {
		checks.push({
			name: "create-index-dimensions",
			status: embedding.configuredDimensionsMatchModel ? "pass" : "warn",
			message: embedding.configuredDimensionsMatchModel
				? `Configured createIndex.dimensions matches the embedding model (${embedding.embeddingDimensions}).`
				: `Configured createIndex.dimensions (${embedding.configuredDimensions}) does not match the embedding model (${embedding.embeddingDimensions}). Index creation uses the live embedding dimensions.`,
		});
	}

	let indexResult:
		| {
				created: boolean;
				dimensions: number;
		  }
		| undefined;
	if (params.createIndexIfMissing) {
		indexResult = await params.service.ensureIndexExists(true, embedding.targetDimensions);
	} else {
		const existingIndex = await params.service.describeIndexIfExists();
		if (existingIndex) {
			indexResult = {
				created: false,
				dimensions: existingIndex.config.dimensions,
			};
		}
	}

	if (!indexResult) {
		checks.push({
			name: "vectorize-index",
			status: "fail",
			message: `Vectorize index "${params.service.config.indexName}" was not found. Run "openclaw cf-memory init" or rerun doctor with --create-index.`,
		});
		checks.push({
			name: "dimension-match",
			status: "warn",
			message: "Skipped dimension comparison because the Vectorize index does not exist yet.",
		});
	} else {
		checks.push({
			name: "vectorize-index",
			status: "pass",
			message: indexResult.created
				? `Created Vectorize index "${params.service.config.indexName}" with ${indexResult.dimensions} dimensions.`
				: `Vectorize index "${params.service.config.indexName}" is reachable.`,
		});
		if (embedding.embeddingDimensions !== indexResult.dimensions) {
			checks.push({
				name: "dimension-match",
				status: "fail",
				message: `Embedding dimensions (${embedding.embeddingDimensions}) do not match the Vectorize index dimensions (${indexResult.dimensions}).`,
			});
		} else {
			checks.push({
				name: "dimension-match",
				status: "pass",
				message: "Embedding dimensions match the Vectorize index.",
			});
		}
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

import { join } from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { resolveConfiguredSecretInputWithFallback } from "openclaw/plugin-sdk/config-runtime";
import type { OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
import type { SecretInput } from "openclaw/plugin-sdk/secret-ref-runtime";
import { z } from "zod";
import {
	CLOUDFLARE_ACCOUNT_ID_ENV,
	CLOUDFLARE_API_TOKEN_ENV,
	COMPANION_PATH_ENV,
	DEFAULT_CLOUDFLARE_API_BASE_URL,
	DEFAULT_EMBEDDING_MODEL,
	DEFAULT_INDEX_DESCRIPTION,
	DEFAULT_INLINE_TEXT_MAX_BYTES,
	DEFAULT_MIN_SCORE,
	DEFAULT_STORAGE_MODE,
	DEFAULT_TOP_K,
	DEFAULT_VECTORIZE_METRIC,
	PLUGIN_ID,
	STORAGE_MODE_ENV,
	VECTORIZE_INDEX_ENV,
	VECTORIZE_NAMESPACE_ENV,
	VECTORIZE_TOP_K_ENV,
	WORKERS_AI_MODEL_ENV,
} from "./constants.js";
import { ConfigurationError } from "./errors.js";
import type { RawPluginConfig, ResolvedPluginConfig, StorageMode, VectorizeMetric } from "./types.js";

const secretRefSchema = z
	.object({
		source: z.enum(["env", "file", "exec"]),
		provider: z.string().min(1),
		id: z.string().min(1),
	})
	.strict();

const secretInputSchema: z.ZodType<SecretInput> = z.union([z.string().min(1), secretRefSchema]);

const createIndexSchema = z
	.object({
		description: z.string().min(1).optional(),
		dimensions: z.number().int().min(1).max(1536).optional(),
		metric: z.enum(["cosine", "euclidean", "dot-product"]).optional(),
	})
	.strict();

const pluginConfigZod: z.ZodType<RawPluginConfig> = z
	.object({
		cloudflare: z
			.object({
				accountId: z.string().min(1).optional(),
				apiToken: secretInputSchema.optional(),
				apiBaseUrl: z.string().url().optional(),
				workersAiBaseUrl: z.string().url().optional(),
				vectorizeBaseUrl: z.string().url().optional(),
			})
			.strict()
			.optional(),
		vectorize: z
			.object({
				indexName: z.string().min(1).optional(),
				namespace: z.string().min(1).optional(),
				topK: z.number().int().min(1).max(50).optional(),
				minScore: z.number().min(0).max(1).optional(),
				metric: z.enum(["cosine", "euclidean", "dot-product"]).optional(),
				createIndex: createIndexSchema.optional(),
				metadataIndexedFields: z.array(z.string().min(1)).default([]),
			})
			.strict()
			.optional(),
		embeddings: z
			.object({
				model: z.string().min(1).optional(),
			})
			.strict()
			.optional(),
		storage: z
			.object({
				mode: z.enum(["vectorize-inline", "companion-store"]).optional(),
				companionStorePath: z.string().min(1).optional(),
				inlineTextMaxBytes: z.number().int().min(256).max(10_000).optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export const pluginConfigJsonSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		cloudflare: {
			type: "object",
			additionalProperties: false,
			properties: {
				accountId: { type: "string" },
				apiToken: {
					anyOf: [
						{ type: "string" },
						{
							type: "object",
							additionalProperties: false,
							properties: {
								source: { type: "string", enum: ["env", "file", "exec"] },
								provider: { type: "string" },
								id: { type: "string" },
							},
							required: ["source", "provider", "id"],
						},
					],
				},
				apiBaseUrl: { type: "string", format: "uri" },
				workersAiBaseUrl: { type: "string", format: "uri" },
				vectorizeBaseUrl: { type: "string", format: "uri" },
			},
		},
		vectorize: {
			type: "object",
			additionalProperties: false,
			properties: {
				indexName: { type: "string" },
				namespace: { type: "string" },
				topK: { type: "integer", minimum: 1, maximum: 50 },
				minScore: { type: "number", minimum: 0, maximum: 1 },
				metric: {
					type: "string",
					enum: ["cosine", "euclidean", "dot-product"],
				},
				createIndex: {
					type: "object",
					additionalProperties: false,
					properties: {
						description: { type: "string" },
						dimensions: { type: "integer", minimum: 1, maximum: 1536 },
						metric: {
							type: "string",
							enum: ["cosine", "euclidean", "dot-product"],
						},
					},
				},
				metadataIndexedFields: {
					type: "array",
					items: { type: "string" },
				},
			},
		},
		embeddings: {
			type: "object",
			additionalProperties: false,
			properties: {
				model: { type: "string" },
			},
		},
		storage: {
			type: "object",
			additionalProperties: false,
			properties: {
				mode: { type: "string", enum: ["vectorize-inline", "companion-store"] },
				companionStorePath: { type: "string" },
				inlineTextMaxBytes: { type: "integer", minimum: 256, maximum: 10000 },
			},
		},
	},
} as const;

export const pluginUiHints = {
	"cloudflare.accountId": {
		label: "Cloudflare account ID",
		help: `Defaults to \${${CLOUDFLARE_ACCOUNT_ID_ENV}}.`,
	},
	"cloudflare.apiToken": {
		label: "Cloudflare API token",
		sensitive: true,
		help: `Defaults to \${${CLOUDFLARE_API_TOKEN_ENV}}.`,
	},
	"vectorize.indexName": {
		label: "Vectorize index name",
		help: `Defaults to \${${VECTORIZE_INDEX_ENV}}.`,
	},
	"vectorize.namespace": {
		label: "Fixed namespace override",
		help: `Defaults to \${${VECTORIZE_NAMESPACE_ENV}} or derives from the agent/session context.`,
	},
	"vectorize.topK": {
		label: "Top-K results",
		help: `Defaults to \${${VECTORIZE_TOP_K_ENV}} or ${DEFAULT_TOP_K}.`,
	},
	"embeddings.model": {
		label: "Workers AI embedding model",
		help: `Defaults to \${${WORKERS_AI_MODEL_ENV}} or ${DEFAULT_EMBEDDING_MODEL}.`,
	},
	"storage.mode": {
		label: "Storage mode",
		help: `Defaults to \${${STORAGE_MODE_ENV}} or ${DEFAULT_STORAGE_MODE}.`,
	},
	"storage.companionStorePath": {
		label: "Companion store path",
		help: `Defaults to \${${COMPANION_PATH_ENV}} or the OpenClaw state directory.`,
	},
} as const;

export const pluginConfigSchema: OpenClawPluginConfigSchema = {
	parse(value: unknown) {
		return pluginConfigZod.parse(value ?? {});
	},
	safeParse(value: unknown) {
		const result = pluginConfigZod.safeParse(value ?? {});
		if (result.success) {
			return { success: true, data: result.data };
		}
		return {
			success: false,
			error: {
				issues: result.error.issues.map((issue) => ({
					path: issue.path.filter((segment): segment is string | number => typeof segment === "string" || typeof segment === "number"),
					message: issue.message,
				})),
			},
		};
	},
	jsonSchema: pluginConfigJsonSchema,
	uiHints: pluginUiHints,
};

type PluginEntriesAwareConfig = OpenClawConfig & {
	plugins?: {
		entries?: Record<string, unknown>;
	};
};

function pickFirstDefined<T>(...values: Array<T | undefined>): T | undefined {
	return values.find((value) => value !== undefined);
}

function pickTrimmed(...values: Array<string | undefined>): string | undefined {
	for (const value of values) {
		if (value && value.trim().length > 0) {
			return value.trim();
		}
	}
	return undefined;
}

function pickNumber(...values: Array<number | undefined>): number | undefined {
	return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

function normalizeMetadataIndexedFields(fields: string[] | undefined): string[] {
	return [...new Set((fields ?? []).map((field) => field.trim()).filter(Boolean))];
}

function ensureVectorizeMetric(metric: VectorizeMetric | undefined): VectorizeMetric {
	return metric ?? DEFAULT_VECTORIZE_METRIC;
}

function ensureStorageMode(mode: StorageMode | undefined): StorageMode {
	return mode ?? DEFAULT_STORAGE_MODE;
}

export function parsePluginConfig(value: unknown): RawPluginConfig {
	return pluginConfigZod.parse(value ?? {});
}

export function getPluginConfigFromOpenClawConfig(config: OpenClawConfig): RawPluginConfig {
	const candidate = (config as PluginEntriesAwareConfig).plugins?.entries?.[PLUGIN_ID];
	return parsePluginConfig(candidate ?? {});
}

export async function resolvePluginConfig(params: {
	pluginConfig: unknown;
	openClawConfig: OpenClawConfig;
	env?: NodeJS.ProcessEnv;
	resolvePath?: (input: string) => string;
}): Promise<ResolvedPluginConfig> {
	const parsed = parsePluginConfig(params.pluginConfig);
	const env = params.env ?? process.env;
	const configPathBase = `plugins.entries.${PLUGIN_ID}`;
	const accountId = pickTrimmed(parsed.cloudflare?.accountId, env[CLOUDFLARE_ACCOUNT_ID_ENV]);
	if (!accountId) {
		throw new ConfigurationError(`Missing Cloudflare account id. Set ${CLOUDFLARE_ACCOUNT_ID_ENV} or ${configPathBase}.cloudflare.accountId.`);
	}

	const tokenResult = await resolveConfiguredSecretInputWithFallback({
		config: params.openClawConfig,
		env,
		value: parsed.cloudflare?.apiToken,
		path: `${configPathBase}.cloudflare.apiToken`,
		unresolvedReasonStyle: "detailed",
		readFallback: () => env[CLOUDFLARE_API_TOKEN_ENV],
	});
	if (!tokenResult.value) {
		const reason = tokenResult.unresolvedRefReason ? ` ${tokenResult.unresolvedRefReason}` : "";
		throw new ConfigurationError(`Missing Cloudflare API token. Set ${CLOUDFLARE_API_TOKEN_ENV} or ${configPathBase}.cloudflare.apiToken.${reason}`.trim());
	}

	const indexName = pickTrimmed(parsed.vectorize?.indexName, env[VECTORIZE_INDEX_ENV]);
	if (!indexName) {
		throw new ConfigurationError(`Missing Vectorize index name. Set ${VECTORIZE_INDEX_ENV} or ${configPathBase}.vectorize.indexName.`);
	}

	const apiBaseUrl = pickTrimmed(parsed.cloudflare?.apiBaseUrl, DEFAULT_CLOUDFLARE_API_BASE_URL);
	if (!apiBaseUrl) {
		throw new ConfigurationError(
			`Invalid Cloudflare API base URL. Set ${configPathBase}.cloudflare.apiBaseUrl or ensure ${DEFAULT_CLOUDFLARE_API_BASE_URL} is a valid URL.`,
		);
	}
	const fixedNamespace = pickTrimmed(parsed.vectorize?.namespace, env[VECTORIZE_NAMESPACE_ENV]);
	const topK = pickNumber(parsed.vectorize?.topK, env[VECTORIZE_TOP_K_ENV] ? Number(env[VECTORIZE_TOP_K_ENV]) : undefined);
	const storageMode = ensureStorageMode(pickFirstDefined(parsed.storage?.mode, env[STORAGE_MODE_ENV] as StorageMode | undefined));
	const companionStorePath = pickTrimmed(parsed.storage?.companionStorePath, env[COMPANION_PATH_ENV]) ?? join(".openclaw", PLUGIN_ID, "companion-store.json");

	const resolvePath = params.resolvePath ?? ((input: string) => input);
	const model = pickTrimmed(parsed.embeddings?.model, env[WORKERS_AI_MODEL_ENV], DEFAULT_EMBEDDING_MODEL);
	if (!model) {
		throw new ConfigurationError(`Missing Workers AI embedding model. Set ${WORKERS_AI_MODEL_ENV} or ${configPathBase}.embeddings.model.`);
	}
	const inlineTextMaxBytes = pickNumber(parsed.storage?.inlineTextMaxBytes) ?? DEFAULT_INLINE_TEXT_MAX_BYTES;
	const minScore = pickNumber(parsed.vectorize?.minScore) ?? DEFAULT_MIN_SCORE;
	const metric = ensureVectorizeMetric(pickFirstDefined(parsed.vectorize?.metric, parsed.vectorize?.createIndex?.metric));

	return {
		accountId,
		apiToken: tokenResult.value,
		apiBaseUrl,
		workersAiBaseUrl: pickTrimmed(parsed.cloudflare?.workersAiBaseUrl) ?? `${apiBaseUrl}/accounts/${accountId}/ai/v1`,
		vectorizeBaseUrl: pickTrimmed(parsed.cloudflare?.vectorizeBaseUrl) ?? `${apiBaseUrl}/accounts/${accountId}/vectorize/v2/indexes/${indexName}`,
		indexName,
		fixedNamespace,
		topK: topK ?? DEFAULT_TOP_K,
		minScore,
		metric,
		model,
		storageMode,
		companionStorePath: resolvePath(companionStorePath),
		inlineTextMaxBytes,
		metadataIndexedFields: normalizeMetadataIndexedFields(parsed.vectorize?.metadataIndexedFields),
		createIndex: {
			description: parsed.vectorize?.createIndex?.description ?? DEFAULT_INDEX_DESCRIPTION,
			dimensions: parsed.vectorize?.createIndex?.dimensions,
			metric,
		},
	};
}

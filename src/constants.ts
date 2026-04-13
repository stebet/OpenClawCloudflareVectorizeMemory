import type { StorageMode, VectorizeMetric } from "./types.js";

export const PLUGIN_ID = "memory-cloudflare-vectorize";
export const PLUGIN_NAME = "Cloudflare Vectorize Memory";
export const PLUGIN_DESCRIPTION = "OpenClaw memory plugin backed by Cloudflare Vectorize and Workers AI embeddings.";
export const CLI_ROOT_COMMAND = "cf-memory";
export const CLI_ROOT_DESCRIPTION = "Manage Cloudflare memory records.";
export const CLI_ROOT_DESCRIPTOR = {
	name: CLI_ROOT_COMMAND,
	description: CLI_ROOT_DESCRIPTION,
	hasSubcommands: true,
} as const;

export const CLOUDFLARE_ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID";
export const CLOUDFLARE_API_TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
export const VECTORIZE_INDEX_ENV = "CLOUDFLARE_VECTORIZE_INDEX_NAME";
export const VECTORIZE_NAMESPACE_ENV = "CLOUDFLARE_VECTORIZE_NAMESPACE";
export const WORKERS_AI_MODEL_ENV = "CLOUDFLARE_WORKERS_AI_EMBEDDING_MODEL";
export const VECTORIZE_TOP_K_ENV = "CLOUDFLARE_VECTORIZE_TOP_K";
export const STORAGE_MODE_ENV = "OPENCLAW_CF_MEMORY_STORAGE_MODE";
export const COMPANION_PATH_ENV = "OPENCLAW_CF_MEMORY_COMPANION_PATH";

export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const DEFAULT_TOP_K = 5;
export const DEFAULT_MIN_SCORE = 0;
export const DEFAULT_INLINE_TEXT_MAX_BYTES = 6_000;
export const DEFAULT_VECTORIZE_METRIC: VectorizeMetric = "cosine";
export const DEFAULT_STORAGE_MODE: StorageMode = "vectorize-inline";
export const DEFAULT_CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
export const DEFAULT_INDEX_DESCRIPTION = "OpenClaw memory index backed by Cloudflare Vectorize.";

export const RESERVED_METADATA_PREFIX = "oc_";
export const RESERVED_METADATA_KEYS = {
	logicalId: "oc_record_id",
	namespace: "oc_namespace",
	title: "oc_title",
	text: "oc_text",
	storageMode: "oc_storage_mode",
	pointer: "oc_pointer",
	source: "oc_source",
	createdAt: "oc_created_at",
	updatedAt: "oc_updated_at",
} as const;

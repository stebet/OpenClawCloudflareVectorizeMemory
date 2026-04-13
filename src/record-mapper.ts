import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { RESERVED_METADATA_KEYS, RESERVED_METADATA_PREFIX } from "./constants.js";
import { RecordSizeError } from "./errors.js";
import type {
	CompanionRecord,
	HydratedMemoryRecord,
	MemoryRecordInput,
	MetadataValue,
	ResolvedPluginConfig,
	VectorizeQueryMatch,
	VectorizeVector,
} from "./types.js";

function sanitizeMetadataKey(key: string): string {
	const sanitized = key.trim().replace(/[.$"]/g, "_").replace(/\s+/g, "_");
	if (!sanitized) {
		return "metadata";
	}
	if (sanitized.startsWith(RESERVED_METADATA_PREFIX)) {
		return `user_${sanitized}`;
	}
	return sanitized;
}

function sanitizeMetadata(metadata: Record<string, MetadataValue> | undefined): Record<string, MetadataValue> {
	if (!metadata) {
		return {};
	}
	const entries = Object.entries(metadata).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value));
	return Object.fromEntries(entries.map(([key, value]) => [sanitizeMetadataKey(key), value]));
}

export function buildVectorId(namespace: string, logicalId: string): string {
	const rawId = `${namespace}::${logicalId}`;
	if (Buffer.byteLength(rawId, "utf8") <= 64) {
		return rawId;
	}
	return `cfm_${createHash("sha256").update(rawId).digest("hex").slice(0, 48)}`;
}

export function buildVirtualPath(namespace: string, logicalId: string): string {
	return `${namespace}/${logicalId}.md`;
}

export function parseVirtualPath(path: string): { namespace: string; logicalId: string } | null {
	const normalized = path.replace(/\\/g, "/").replace(/^\//, "");
	const segments = normalized.split("/");
	if (segments.length !== 2 || !segments[1].endsWith(".md")) {
		return null;
	}
	return {
		namespace: segments[0],
		logicalId: segments[1].slice(0, -3),
	};
}

export function buildSnippet(text: string, query: string): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (!normalized) {
		return "";
	}
	const lower = normalized.toLowerCase();
	const index = lower.indexOf(query.trim().toLowerCase());
	if (index === -1) {
		return normalized.slice(0, 220);
	}
	const start = Math.max(0, index - 80);
	const end = Math.min(normalized.length, index + Math.max(query.length, 40) + 80);
	return normalized.slice(start, end);
}

export function mapRecordForUpsert(params: { input: MemoryRecordInput; namespace: string; embedding: number[]; config: ResolvedPluginConfig }): {
	logicalId: string;
	vectorId: string;
	path: string;
	vector: VectorizeVector;
	companionRecord?: CompanionRecord;
} {
	const logicalId = params.input.id?.trim() || randomUUID();
	const vectorId = buildVectorId(params.namespace, logicalId);
	const now = new Date().toISOString();
	const userMetadata = sanitizeMetadata(params.input.metadata);
	const metadataBase: Record<string, MetadataValue> = {
		...userMetadata,
		[RESERVED_METADATA_KEYS.logicalId]: logicalId,
		[RESERVED_METADATA_KEYS.storageMode]: params.config.storageMode,
		[RESERVED_METADATA_KEYS.createdAt]: now,
		[RESERVED_METADATA_KEYS.updatedAt]: now,
	};

	if (params.input.title) {
		metadataBase[RESERVED_METADATA_KEYS.title] = params.input.title;
	}
	if (params.input.source) {
		metadataBase[RESERVED_METADATA_KEYS.source] = params.input.source;
	}

	let companionRecord: CompanionRecord | undefined;
	if (params.config.storageMode === "vectorize-inline") {
		const byteLength = Buffer.byteLength(params.input.text, "utf8");
		if (byteLength > params.config.inlineTextMaxBytes) {
			throw new RecordSizeError(
				`Memory text is ${byteLength} bytes, which exceeds the inline metadata limit of ${params.config.inlineTextMaxBytes}. Switch storage.mode to "companion-store" or reduce the payload size.`,
			);
		}
		metadataBase[RESERVED_METADATA_KEYS.text] = params.input.text;
	} else {
		const pointer = buildVirtualPath(params.namespace, logicalId);
		metadataBase[RESERVED_METADATA_KEYS.pointer] = pointer;
		companionRecord = {
			id: logicalId,
			namespace: params.namespace,
			title: params.input.title,
			text: params.input.text,
			metadata: userMetadata,
			source: params.input.source,
			createdAt: now,
			updatedAt: now,
		};
	}

	return {
		logicalId,
		vectorId,
		path: buildVirtualPath(params.namespace, logicalId),
		vector: {
			id: vectorId,
			namespace: params.namespace,
			values: params.embedding,
			metadata: metadataBase,
		},
		companionRecord,
	};
}

export function hydrateInlineRecord(match: VectorizeQueryMatch): Omit<HydratedMemoryRecord, "text" | "path"> & {
	text?: string;
	path: string;
} {
	const metadata = match.metadata ?? {};
	const namespace =
		match.namespace ?? (typeof metadata[RESERVED_METADATA_KEYS.pointer] === "string" ? String(metadata[RESERVED_METADATA_KEYS.pointer]).split("/")[0] : "main");
	const logicalId =
		typeof metadata[RESERVED_METADATA_KEYS.logicalId] === "string" ? String(metadata[RESERVED_METADATA_KEYS.logicalId]) : String(match.id ?? "");
	const userMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => !key.startsWith(RESERVED_METADATA_PREFIX)));
	return {
		logicalId,
		vectorId: String(match.id ?? logicalId),
		namespace,
		title: typeof metadata[RESERVED_METADATA_KEYS.title] === "string" ? String(metadata[RESERVED_METADATA_KEYS.title]) : undefined,
		text: typeof metadata[RESERVED_METADATA_KEYS.text] === "string" ? String(metadata[RESERVED_METADATA_KEYS.text]) : undefined,
		metadata: userMetadata,
		source: typeof metadata[RESERVED_METADATA_KEYS.source] === "string" ? String(metadata[RESERVED_METADATA_KEYS.source]) : undefined,
		createdAt: typeof metadata[RESERVED_METADATA_KEYS.createdAt] === "string" ? String(metadata[RESERVED_METADATA_KEYS.createdAt]) : undefined,
		updatedAt: typeof metadata[RESERVED_METADATA_KEYS.updatedAt] === "string" ? String(metadata[RESERVED_METADATA_KEYS.updatedAt]) : undefined,
		path: buildVirtualPath(namespace, logicalId),
	};
}

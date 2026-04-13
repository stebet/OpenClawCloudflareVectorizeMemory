import type { SecretInput } from "openclaw/plugin-sdk/secret-ref-runtime";

export type MetadataValue = string | number | boolean;

export type MetadataFilterClause =
	| MetadataValue
	| {
			$eq?: MetadataValue;
			$ne?: MetadataValue;
			$in?: MetadataValue[];
			$nin?: MetadataValue[];
			$lt?: number;
			$lte?: number;
			$gt?: number;
			$gte?: number;
	  };

export type MetadataFilter = Record<string, MetadataFilterClause>;

export type StorageMode = "vectorize-inline" | "companion-store";
export type VectorizeMetric = "cosine" | "euclidean" | "dot-product";

export type RawPluginConfig = {
	cloudflare?: {
		accountId?: string;
		apiToken?: SecretInput;
		apiBaseUrl?: string;
		workersAiBaseUrl?: string;
		vectorizeBaseUrl?: string;
	};
	vectorize?: {
		indexName?: string;
		namespace?: string;
		topK?: number;
		minScore?: number;
		metric?: VectorizeMetric;
		createIndex?: {
			description?: string;
			dimensions?: number;
			metric?: VectorizeMetric;
		};
		metadataIndexedFields?: string[];
	};
	embeddings?: {
		model?: string;
	};
	storage?: {
		mode?: StorageMode;
		companionStorePath?: string;
		inlineTextMaxBytes?: number;
	};
};

export type ResolvedPluginConfig = {
	accountId: string;
	apiToken: string;
	apiBaseUrl: string;
	workersAiBaseUrl: string;
	vectorizeBaseUrl: string;
	indexName: string;
	fixedNamespace?: string;
	topK: number;
	minScore: number;
	metric: VectorizeMetric;
	model: string;
	storageMode: StorageMode;
	companionStorePath: string;
	inlineTextMaxBytes: number;
	metadataIndexedFields: string[];
	createIndex: {
		description: string;
		dimensions?: number;
		metric: VectorizeMetric;
	};
};

export type VectorizeVector = {
	id: string;
	values: number[];
	metadata?: Record<string, MetadataValue>;
	namespace?: string;
};

export type VectorizeQueryMatch = {
	id?: string;
	score?: number;
	namespace?: string;
	metadata?: Record<string, MetadataValue>;
	values?: number[];
};

export type VectorizeIndexDescription = {
	name?: string;
	description?: string;
	created_on?: string;
	modified_on?: string;
	config: {
		dimensions: number;
		metric: VectorizeMetric;
	};
};

export type MemoryRecordInput = {
	id?: string;
	text: string;
	title?: string;
	metadata?: Record<string, MetadataValue>;
	namespace?: string;
	source?: string;
};

export type CompanionRecord = {
	id: string;
	namespace: string;
	title?: string;
	text: string;
	metadata: Record<string, MetadataValue>;
	source?: string;
	createdAt: string;
	updatedAt: string;
};

export type HydratedMemoryRecord = {
	logicalId: string;
	vectorId: string;
	namespace: string;
	title?: string;
	text: string;
	metadata: Record<string, MetadataValue>;
	source?: string;
	createdAt?: string;
	updatedAt?: string;
	path: string;
};

export type UpsertedMemoryRecord = HydratedMemoryRecord & {
	mutationId?: string;
};

export type DoctorCheck = {
	name: string;
	status: "pass" | "warn" | "fail";
	message: string;
};

export type DoctorReport = {
	ok: boolean;
	checks: DoctorCheck[];
};

export type EmbeddingDimensionsInspection = {
	embeddingDimensions: number;
	configuredDimensions?: number;
	configuredDimensionsMatchModel: boolean;
	targetDimensions: number;
};

export type IndexInitializationReport = {
	ok: boolean;
	checks: DoctorCheck[];
	created: boolean;
	recreated: boolean;
	embeddingDimensions: number;
	indexDimensions?: number;
};

export type SmokeTestReport = {
	ok: boolean;
	checks: DoctorCheck[];
	namespace: string;
	logicalId: string;
};

export type MigrationSourceMode = "paths" | "default-provider";
export type MigrationDuplicateStrategy = "overwrite" | "skip" | "fail";
export type MigrationNamespaceStrategy = "single-target" | "path";
export type MigrationResultAction = "would-import" | "imported" | "skipped" | "failed";

export type MigrationRunOptions = {
	sourcePaths?: string[];
	workspaceDir?: string;
	namespace?: string;
	namespaceStrategy?: MigrationNamespaceStrategy;
	duplicateStrategy?: MigrationDuplicateStrategy;
	dryRun?: boolean;
	createIndexIfMissing?: boolean;
};

export type MigrationResult = {
	action: MigrationResultAction;
	sourcePath: string;
	relativePath: string;
	logicalId?: string;
	namespace?: string;
	title?: string;
	reason?: string;
	error?: string;
};

export type MigrationSummary = {
	dryRun: boolean;
	sourceMode: MigrationSourceMode;
	workspaceDir: string;
	namespaceStrategy: MigrationNamespaceStrategy;
	targetNamespace?: string;
	discoveredFiles: number;
	preparedRecords: number;
	imported: number;
	skipped: number;
	failed: number;
	doctor: DoctorReport;
	results: MigrationResult[];
};

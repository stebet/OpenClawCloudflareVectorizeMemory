import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { DoctorReport, IndexInitializationReport, MetadataFilter, MigrationDuplicateStrategy, SmokeTestReport } from "./types.js";
import { formatMigrationSummary, runCloudflareMemoryMigration } from "./migration.js";
import { createCloudflareMemoryService } from "./service-factory.js";

type CliCommand = {
	command: (name: string) => CliCommand;
	description: (description: string) => CliCommand;
	argument: (name: string, description: string) => CliCommand;
	option: (flags: string, description: string) => CliCommand;
	action: (handler: (...args: unknown[]) => Promise<void> | void) => CliCommand;
	opts?: () => Record<string, unknown>;
};

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function printCheckReport(report: DoctorReport | IndexInitializationReport | SmokeTestReport): void {
	for (const check of report.checks) {
		console.log(`[${check.status}] ${check.name}: ${check.message}`);
	}
}

function parseMetadataFlag(value: string | undefined): Record<string, string | number | boolean> | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = JSON.parse(value) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("--metadata must be a JSON object.");
	}
	return parsed as Record<string, string | number | boolean>;
}

function parseFilterFlag(value: string | undefined): MetadataFilter | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = JSON.parse(value) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("--filter must be a JSON object.");
	}
	return parsed as MetadataFilter;
}

function isCliCommand(value: unknown): value is CliCommand {
	return Boolean(value) && typeof value === "object" && typeof (value as CliCommand).opts === "function";
}

function resolveInvocation(args: unknown[]): { positionals: unknown[]; options: Record<string, unknown> } {
	const maybeCommand = args.at(-1);
	if (!isCliCommand(maybeCommand)) {
		return {
			positionals: args,
			options: {},
		};
	}
	return {
		positionals: args.slice(0, -1),
		options: maybeCommand.opts?.() ?? {},
	};
}

function parseDuplicateStrategy(value: unknown): MigrationDuplicateStrategy | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "overwrite" || value === "skip" || value === "fail") {
		return value;
	}
	throw new Error("--if-exists must be overwrite, skip, or fail.");
}

export function registerCloudflareMemoryCli(
	program: {
		command: (name: string) => CliCommand;
	},
	params: {
		pluginConfig: unknown;
		openClawConfig: OpenClawConfig;
		resolvePath?: (input: string) => string;
	},
): void {
	const root = program.command("cf-memory").description("Manage Cloudflare memory records.");

	function resolveOptions(args: unknown[]): Record<string, unknown> {
		return resolveInvocation(args).options;
	}

	root
		.command("doctor")
		.description("Validate Workers AI and Vectorize configuration.")
		.option("--create-index", "Create the Vectorize index if missing.")
		.option("--json", "Print structured JSON output.")
		.action(async (...args) => {
			const options = resolveOptions(args);
			const service = await createCloudflareMemoryService({
				pluginConfig: params.pluginConfig,
				openClawConfig: params.openClawConfig,
				env: process.env,
				resolvePath: params.resolvePath,
			});
			const report = await service.doctor({
				createIndexIfMissing: Boolean(options.createIndex),
			});
			if (options.json) {
				printJson(report);
			} else {
				printCheckReport(report);
			}
			if (!report.ok) {
				process.exitCode = 1;
			}
		});

	root
		.command("init")
		.description("Initialize the Cloudflare Vectorize index for the configured embedding model.")
		.option("--json", "Print structured JSON output.")
		.action(async (...args) => {
			const options = resolveOptions(args);
			const service = await createCloudflareMemoryService({
				pluginConfig: params.pluginConfig,
				openClawConfig: params.openClawConfig,
				env: process.env,
				resolvePath: params.resolvePath,
			});
			const report = await service.initializeIndex();
			if (options.json) {
				printJson(report);
			} else {
				printCheckReport(report);
			}
			if (!report.ok) {
				process.exitCode = 1;
			}
		});

	root
		.command("test")
		.description("Run an end-to-end embedding and semantic-search smoke test.")
		.option("--json", "Print structured JSON output.")
		.action(async (...args) => {
			const options = resolveOptions(args);
			const service = await createCloudflareMemoryService({
				pluginConfig: params.pluginConfig,
				openClawConfig: params.openClawConfig,
				env: process.env,
				resolvePath: params.resolvePath,
			});
			const report = await service.runSmokeTest();
			if (options.json) {
				printJson(report);
			} else {
				printCheckReport(report);
			}
			if (!report.ok) {
				process.exitCode = 1;
			}
		});

	root
		.command("search")
		.description("Search stored Cloudflare memory.")
		.argument("<query>", "Semantic search query.")
		.option("--namespace <namespace>", "Optional namespace override.")
		.option("--limit <count>", "Maximum number of results.")
		.option("--filter <json>", "Optional metadata filter JSON.")
		.action(async (query, opts) => {
			const options = opts as Record<string, unknown>;
			const service = await createCloudflareMemoryService({
				pluginConfig: params.pluginConfig,
				openClawConfig: params.openClawConfig,
				env: process.env,
				resolvePath: params.resolvePath,
			});
			const results = await service.search({
				query: String(query),
				namespace: options.namespace as string | undefined,
				maxResults: options.limit ? Number(options.limit) : undefined,
				filter: parseFilterFlag(options.filter as string | undefined),
			});
			printJson(results);
		});

	root
		.command("upsert")
		.description("Insert or update a memory record.")
		.argument("<text>", "Memory text.")
		.option("--id <id>", "Stable logical id.")
		.option("--title <title>", "Optional title.")
		.option("--namespace <namespace>", "Optional namespace override.")
		.option("--source <source>", "Optional source label.")
		.option("--metadata <json>", "Optional metadata JSON object.")
		.action(async (text, opts) => {
			const options = opts as Record<string, unknown>;
			const service = await createCloudflareMemoryService({
				pluginConfig: params.pluginConfig,
				openClawConfig: params.openClawConfig,
				env: process.env,
				resolvePath: params.resolvePath,
			});
			const result = await service.upsert({
				input: {
					id: options.id as string | undefined,
					title: options.title as string | undefined,
					text: String(text),
					namespace: options.namespace as string | undefined,
					source: options.source as string | undefined,
					metadata: parseMetadataFlag(options.metadata as string | undefined),
				},
			});
			printJson(result);
		});

	root
		.command("delete")
		.description("Delete a memory record.")
		.argument("<id>", "Logical memory record id.")
		.option("--namespace <namespace>", "Optional namespace override.")
		.action(async (id, opts) => {
			const options = opts as Record<string, unknown>;
			const service = await createCloudflareMemoryService({
				pluginConfig: params.pluginConfig,
				openClawConfig: params.openClawConfig,
				env: process.env,
				resolvePath: params.resolvePath,
			});
			const mutationId = await service.delete({
				id: String(id),
				namespace: options.namespace as string | undefined,
			});
			printJson({ id, mutationId });
		});

	root
		.command("migrate")
		.description("Migrate legacy markdown memory into Cloudflare Vectorize.")
		.argument("[sources...]", "Markdown files, directories, or glob patterns. Defaults to the current OpenClaw memory corpus when omitted.")
		.option("--workspace <path>", "Workspace root used for default-provider discovery and relative path normalization.")
		.option("--namespace <namespace>", "Target namespace override.")
		.option("--derive-namespace-from-path", "Derive namespaces from the first relative path segment instead of using a single target namespace.")
		.option("--if-exists <strategy>", "Duplicate handling: overwrite, skip, or fail.")
		.option("--create-index", "Create the Vectorize index if missing.")
		.option("--dry-run", "Plan the migration without writing records.")
		.option("--json", "Print structured JSON output.")
		.action(async (...args) => {
			const { positionals, options } = resolveInvocation(args);
			const rawSources = positionals[0];
			const sourcePaths =
				positionals.length === 0 ? [] : Array.isArray(rawSources) ? rawSources.map((value) => String(value)) : positionals.map((value) => String(value));
			const service = await createCloudflareMemoryService({
				pluginConfig: params.pluginConfig,
				openClawConfig: params.openClawConfig,
				env: process.env,
				resolvePath: params.resolvePath,
			});
			const summary = await runCloudflareMemoryMigration({
				service,
				options: {
					sourcePaths,
					workspaceDir: options.workspace as string | undefined,
					namespace: options.namespace as string | undefined,
					namespaceStrategy: options.deriveNamespaceFromPath ? "path" : "single-target",
					duplicateStrategy: parseDuplicateStrategy(options.ifExists),
					dryRun: Boolean(options.dryRun),
					createIndexIfMissing: Boolean(options.createIndex),
				},
			});
			if (options.json) {
				printJson(summary);
			} else {
				console.log(formatMigrationSummary(summary));
			}
			if (summary.failed > 0) {
				process.exitCode = 1;
			}
		});
}

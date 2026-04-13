import { createHash } from "node:crypto";
import { glob, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { listMemoryFiles } from "openclaw/plugin-sdk/memory-core";
import { sanitizeNamespace } from "./namespace.js";
import type { CloudflareMemoryService } from "./service.js";
import type {
	DoctorReport,
	MetadataValue,
	MigrationDuplicateStrategy,
	MigrationNamespaceStrategy,
	MigrationResult,
	MigrationRunOptions,
	MigrationSourceMode,
	MigrationSummary,
} from "./types.js";

type DiscoveredMigrationFile = {
	absolutePath: string;
	relativePath: string;
};

type ParsedMigrationRecord = {
	input: {
		id: string;
		text: string;
		title?: string;
		metadata: Record<string, MetadataValue>;
		namespace?: string;
		source?: string;
	};
	sourcePath: string;
	relativePath: string;
};

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const RESERVED_FRONTMATTER_FIELDS = new Set(["id", "namespace", "source", "title"]);

function normalizePathForMetadata(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeRelativePath(value: string): string {
	const normalized = normalizePathForMetadata(value).replace(/^\/+/, "");
	return normalized || basename(value);
}

function isMarkdownFile(value: string): boolean {
	return MARKDOWN_EXTENSIONS.has(extname(value).toLowerCase());
}

function hasGlobMagic(value: string): boolean {
	return /[*?[\]{}]/.test(value);
}

function shouldIgnoreDiscoveredFile(value: string): boolean {
	const normalized = normalizePathForMetadata(value).toLowerCase();
	return normalized.includes("/node_modules/") || normalized.includes("/.git/");
}

async function statIfExists(path: string) {
	try {
		return await stat(path);
	} catch {
		return null;
	}
}

async function collectDirectoryMarkdownFiles(directory: string): Promise<string[]> {
	const matches: string[] = [];
	for await (const match of glob("**/*.{md,markdown}", { cwd: directory })) {
		const absolutePath = resolve(directory, match);
		if (!shouldIgnoreDiscoveredFile(absolutePath)) {
			matches.push(absolutePath);
		}
	}
	return matches;
}

async function collectGlobMatches(pattern: string, workspaceDir: string): Promise<string[]> {
	const matches: string[] = [];
	const normalizedPattern = normalizePathForMetadata(pattern);
	const iterator = isAbsolute(pattern) ? glob(normalizedPattern) : glob(normalizedPattern, { cwd: workspaceDir });
	for await (const match of iterator) {
		const absolutePath = isAbsolute(match) ? match : resolve(workspaceDir, match);
		if (shouldIgnoreDiscoveredFile(absolutePath) || !isMarkdownFile(absolutePath)) {
			continue;
		}
		const fileStats = await statIfExists(absolutePath);
		if (fileStats?.isFile()) {
			matches.push(absolutePath);
		}
	}
	return matches;
}

export async function discoverMigrationFiles(params: {
	workspaceDir: string;
	sourceMode: MigrationSourceMode;
	sourcePaths?: string[];
}): Promise<DiscoveredMigrationFile[]> {
	const workspaceDir = resolve(params.workspaceDir);
	const discovered = new Map<string, DiscoveredMigrationFile>();

	if (params.sourceMode === "default-provider") {
		for (const relPath of await listMemoryFiles(workspaceDir)) {
			const relativePath = normalizeRelativePath(relPath);
			const absolutePath = resolve(workspaceDir, relativePath);
			if (shouldIgnoreDiscoveredFile(absolutePath) || !isMarkdownFile(relativePath)) {
				continue;
			}
			const fileStats = await statIfExists(absolutePath);
			if (fileStats?.isFile()) {
				discovered.set(absolutePath.toLowerCase(), {
					absolutePath,
					relativePath,
				});
			}
		}
	}

	for (const input of params.sourcePaths ?? []) {
		const absoluteInput = resolve(workspaceDir, input);
		const fileStats = await statIfExists(absoluteInput);
		let matches: string[] = [];
		if (fileStats?.isDirectory()) {
			matches = await collectDirectoryMarkdownFiles(absoluteInput);
		} else if (fileStats?.isFile()) {
			matches = isMarkdownFile(absoluteInput) ? [absoluteInput] : [];
		} else if (hasGlobMagic(input)) {
			matches = await collectGlobMatches(input, workspaceDir);
		}

		for (const match of matches) {
			const relativePath = normalizeRelativePath(relative(workspaceDir, match));
			discovered.set(match.toLowerCase(), {
				absolutePath: match,
				relativePath,
			});
		}
	}

	return [...discovered.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function parseFrontmatterValue(value: string): MetadataValue | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	if (/^"(.*)"$/.test(trimmed) || /^'(.*)'$/.test(trimmed)) {
		return trimmed.slice(1, -1);
	}
	if (trimmed === "true") {
		return true;
	}
	if (trimmed === "false") {
		return false;
	}
	const numeric = Number(trimmed);
	if (!Number.isNaN(numeric) && trimmed !== "") {
		return numeric;
	}
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		return undefined;
	}
	return trimmed;
}

function parseFrontmatter(content: string): { body: string; attributes: Record<string, MetadataValue> } {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) {
		return { body: normalized, attributes: {} };
	}

	const lines = normalized.split("\n");
	const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (closingIndex === -1) {
		return { body: normalized, attributes: {} };
	}

	const attributes: Record<string, MetadataValue> = {};
	for (const line of lines.slice(1, closingIndex)) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) {
			continue;
		}
		const key = line.slice(0, separatorIndex).trim();
		if (!key) {
			continue;
		}
		const parsedValue = parseFrontmatterValue(line.slice(separatorIndex + 1));
		if (parsedValue !== undefined) {
			attributes[key] = parsedValue;
		}
	}

	return {
		body: lines.slice(closingIndex + 1).join("\n"),
		attributes,
	};
}

function extractHeadingTitleAndBody(content: string): { title?: string; text: string } {
	const lines = content.split("\n");
	const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
	if (firstContentLine === -1) {
		return { text: "" };
	}

	const headingMatch = /^#\s+(.+?)\s*$/.exec(lines[firstContentLine]?.trim() ?? "");
	if (!headingMatch) {
		return { text: content.trim() };
	}

	const remainingLines = [...lines];
	remainingLines.splice(firstContentLine, 1);
	if ((remainingLines[firstContentLine] ?? "").trim() === "") {
		remainingLines.splice(firstContentLine, 1);
	}
	const body = remainingLines.join("\n").trim();
	return {
		title: headingMatch[1].trim(),
		text: body || content.trim(),
	};
}

function buildStableLogicalId(relativePath: string): string {
	const withoutExtension = relativePath.replace(/\.(md|markdown)$/i, "");
	const slug = withoutExtension
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	const hash = createHash("sha1").update(relativePath).digest("hex").slice(0, 10);
	return `${slug || "memory"}-${hash}`;
}

function pickTitle(relativePath: string, frontmatterTitle: MetadataValue | undefined, headingTitle: string | undefined): string | undefined {
	if (typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0) {
		return frontmatterTitle.trim();
	}
	if (headingTitle) {
		return headingTitle;
	}
	const fileName = basename(relativePath, extname(relativePath)).trim();
	return fileName || undefined;
}

function buildTargetNamespace(service: CloudflareMemoryService, options: MigrationRunOptions, workspaceDir: string): string {
	return service.resolveNamespace({
		namespace: options.namespace,
		workspaceDir,
	});
}

function deriveRecordNamespace(params: {
	relativePath: string;
	frontmatterNamespace: MetadataValue | undefined;
	targetNamespace: string;
	namespaceStrategy: MigrationNamespaceStrategy;
}): string {
	if (params.namespaceStrategy === "single-target") {
		return params.targetNamespace;
	}

	if (typeof params.frontmatterNamespace === "string" && params.frontmatterNamespace.trim().length > 0) {
		return sanitizeNamespace(params.frontmatterNamespace);
	}

	const firstSegment = normalizeRelativePath(params.relativePath).split("/")[0];
	if (!firstSegment || firstSegment === "." || firstSegment === "..") {
		return params.targetNamespace;
	}
	return sanitizeNamespace(firstSegment);
}

export async function parseMigrationFile(params: {
	file: DiscoveredMigrationFile;
	sourceMode: MigrationSourceMode;
	targetNamespace: string;
	namespaceStrategy: MigrationNamespaceStrategy;
}): Promise<ParsedMigrationRecord | null> {
	const raw = await readFile(params.file.absolutePath, "utf8");
	const { body, attributes } = parseFrontmatter(raw);
	const { title: headingTitle, text: extractedText } = extractHeadingTitleAndBody(body);
	const title = pickTitle(params.file.relativePath, attributes.title, headingTitle);
	const text = extractedText.trim() || title || "";
	if (!text) {
		return null;
	}

	const metadata: Record<string, MetadataValue> = {
		legacySourceMode: params.sourceMode,
		legacySourcePath: params.file.relativePath.startsWith("..") ? params.file.absolutePath : params.file.relativePath,
	};
	for (const [key, value] of Object.entries(attributes)) {
		if (RESERVED_FRONTMATTER_FIELDS.has(key)) {
			continue;
		}
		metadata[key] = value;
	}

	const logicalId =
		typeof attributes.id === "string" && attributes.id.trim().length > 0 ? attributes.id.trim() : buildStableLogicalId(params.file.relativePath);
	const namespace = deriveRecordNamespace({
		relativePath: params.file.relativePath,
		frontmatterNamespace: attributes.namespace,
		targetNamespace: params.targetNamespace,
		namespaceStrategy: params.namespaceStrategy,
	});
	const source =
		typeof attributes.source === "string" && attributes.source.trim().length > 0
			? attributes.source.trim()
			: params.sourceMode === "default-provider"
				? "openclaw-default-memory"
				: "markdown-import";

	return {
		sourcePath: params.file.absolutePath,
		relativePath: params.file.relativePath,
		input: {
			id: logicalId,
			namespace,
			title,
			text,
			source,
			metadata,
		},
	};
}

function formatDoctorFailure(report: DoctorReport): string {
	const failedChecks = report.checks.filter((check) => check.status === "fail");
	return failedChecks.map((check) => `${check.name}: ${check.message}`).join(" | ");
}

export async function runCloudflareMemoryMigration(params: {
	service: CloudflareMemoryService;
	options?: MigrationRunOptions;
}): Promise<MigrationSummary> {
	const options = params.options ?? {};
	const workspaceDir = resolve(options.workspaceDir ?? process.cwd());
	const sourceMode: MigrationSourceMode = (options.sourcePaths?.length ?? 0) > 0 ? "paths" : "default-provider";
	const namespaceStrategy = options.namespaceStrategy ?? "single-target";
	const duplicateStrategy: MigrationDuplicateStrategy = options.duplicateStrategy ?? "overwrite";
	const dryRun = options.dryRun ?? false;
	const targetNamespace = buildTargetNamespace(params.service, options, workspaceDir);
	const doctor = await params.service.doctor({
		createIndexIfMissing: options.createIndexIfMissing ?? false,
	});
	if (!doctor.ok) {
		throw new Error(`Migration validation failed. ${formatDoctorFailure(doctor)}`);
	}

	const discoveredFiles = await discoverMigrationFiles({
		workspaceDir,
		sourceMode,
		sourcePaths: options.sourcePaths,
	});
	if (discoveredFiles.length === 0) {
		throw new Error(
			sourceMode === "default-provider"
				? `No default OpenClaw markdown memory files were found under ${workspaceDir}.`
				: "No markdown files matched the provided migration sources.",
		);
	}

	const results: MigrationResult[] = [];
	let preparedRecords = 0;
	let imported = 0;
	let skipped = 0;
	let failed = 0;

	for (const file of discoveredFiles) {
		try {
			const parsed = await parseMigrationFile({
				file,
				sourceMode,
				targetNamespace,
				namespaceStrategy,
			});
			if (!parsed) {
				skipped += 1;
				results.push({
					action: "skipped",
					sourcePath: file.absolutePath,
					relativePath: file.relativePath,
					reason: "File did not contain any importable markdown content.",
				});
				continue;
			}

			preparedRecords += 1;
			const logicalId = parsed.input.id;
			const namespace = parsed.input.namespace;
			if (!logicalId || !namespace) {
				throw new Error("Parsed migration record is missing a logical id or namespace.");
			}

			if (duplicateStrategy !== "overwrite") {
				const existing = await params.service.get({
					id: logicalId,
					namespace,
				});
				if (existing) {
					if (duplicateStrategy === "skip") {
						skipped += 1;
						results.push({
							action: "skipped",
							sourcePath: parsed.sourcePath,
							relativePath: parsed.relativePath,
							logicalId,
							namespace,
							title: parsed.input.title,
							reason: "A record with the same logical id already exists.",
						});
						continue;
					}
					throw new Error(`A record with logical id ${logicalId} already exists in namespace ${namespace}.`);
				}
			}

			if (dryRun) {
				results.push({
					action: "would-import",
					sourcePath: parsed.sourcePath,
					relativePath: parsed.relativePath,
					logicalId,
					namespace,
					title: parsed.input.title,
				});
				continue;
			}

			await params.service.upsert({
				input: parsed.input,
			});
			imported += 1;
			results.push({
				action: "imported",
				sourcePath: parsed.sourcePath,
				relativePath: parsed.relativePath,
				logicalId,
				namespace,
				title: parsed.input.title,
			});
		} catch (error) {
			failed += 1;
			results.push({
				action: "failed",
				sourcePath: file.absolutePath,
				relativePath: file.relativePath,
				error: error instanceof Error ? error.message : "Unknown migration failure.",
			});
		}
	}

	return {
		dryRun,
		sourceMode,
		workspaceDir,
		namespaceStrategy,
		targetNamespace: namespaceStrategy === "single-target" ? targetNamespace : undefined,
		discoveredFiles: discoveredFiles.length,
		preparedRecords,
		imported,
		skipped,
		failed,
		doctor,
		results,
	};
}

export function formatMigrationSummary(summary: MigrationSummary): string {
	const lines = [
		`${summary.dryRun ? "Dry-run" : "Migration"} ${summary.failed > 0 ? "completed with failures" : "completed"}.`,
		`Source mode: ${summary.sourceMode}`,
		`Workspace: ${summary.workspaceDir}`,
		`Files scanned: ${summary.discoveredFiles}`,
		`Records prepared: ${summary.preparedRecords}`,
		`Imported: ${summary.imported}`,
		`Skipped: ${summary.skipped}`,
		`Failed: ${summary.failed}`,
	];

	if (summary.targetNamespace) {
		lines.splice(3, 0, `Target namespace: ${summary.targetNamespace}`);
	}

	const failedResults = summary.results.filter((result) => result.action === "failed").slice(0, 10);
	if (failedResults.length > 0) {
		lines.push("", "Failures:");
		for (const result of failedResults) {
			lines.push(`- ${result.relativePath}: ${result.error}`);
		}
	}

	return lines.join("\n");
}

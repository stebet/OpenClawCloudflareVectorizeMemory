import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { AnyAgentTool, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeleteTool, createGetTool, createSearchTool, createUpsertTool } from "../src/tools.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const openClawBin = join(repoRoot, "node_modules", "openclaw", "openclaw.mjs");
const dotEnvPath = join(repoRoot, ".env");
const dotEnvExamplePath = join(repoRoot, ".env.example");
const requiredEnvVars = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_VECTORIZE_INDEX_NAME"] as const;
const placeholderTemplateValues: Partial<Record<string, string>> = {
	OPENCLAW_CF_MEMORY_RUN_LIVE_INTEGRATION: "0",
	CLOUDFLARE_ACCOUNT_ID: "replace-with-your-cloudflare-account-id",
	CLOUDFLARE_API_TOKEN: "replace-with-your-cloudflare-api-token",
	CLOUDFLARE_VECTORIZE_INDEX_NAME: "replace-with-your-disposable-vectorize-index",
};

function parseDotEnv(contents: string): Record<string, string> {
	return Object.fromEntries(
		contents
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"))
			.map((line) => {
				const separatorIndex = line.indexOf("=");
				if (separatorIndex === -1) {
					return [line, ""];
				}

				const key = line.slice(0, separatorIndex).trim();
				const rawValue = line.slice(separatorIndex + 1).trim();
				const value =
					(rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'")) ? rawValue.slice(1, -1) : rawValue;
				return [key, value];
			}),
	);
}

function loadDotEnvFile(path: string): Record<string, string> {
	if (!existsSync(path)) {
		return {};
	}
	return parseDotEnv(readFileSync(path, "utf8"));
}

const dotEnvValues = loadDotEnvFile(dotEnvPath);
const dotEnvExampleValues = loadDotEnvFile(dotEnvExamplePath);

function isPlaceholderValue(name: string, value: string | undefined): boolean {
	if (!value) {
		return true;
	}
	return value.startsWith("replace-with-") || placeholderTemplateValues[name] === value;
}

function getConfiguredValue(name: string): string | undefined {
	for (const source of [process.env, dotEnvValues, dotEnvExampleValues]) {
		const rawValue = source[name]?.trim();
		if (!isPlaceholderValue(name, rawValue)) {
			return rawValue;
		}
	}
	return undefined;
}

const resolvedDotEnvValues = Object.fromEntries(
	[
		...new Set([
			...Object.keys(dotEnvExampleValues),
			...Object.keys(dotEnvValues),
			...requiredEnvVars,
			"OPENCLAW_CF_MEMORY_RUN_LIVE_INTEGRATION",
			"OPENCLAW_CF_MEMORY_TEST_NAMESPACE_PREFIX",
			"CLOUDFLARE_WORKERS_AI_EMBEDDING_MODEL",
		]),
	]
		.map((name) => [name, getConfiguredValue(name)] as const)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

const shouldRunLiveIntegration =
	getConfiguredValue("OPENCLAW_CF_MEMORY_RUN_LIVE_INTEGRATION") === "1" && requiredEnvVars.every((name) => Boolean(getConfiguredValue(name)));
const liveDescribe = shouldRunLiveIntegration ? describe : describe.skip;

function createLiveOpenClawConfig(): OpenClawConfig {
	return {
		plugins: {
			load: {
				paths: [repoRoot],
			},
			slots: {
				memory: "memory-cloudflare-vectorize",
			},
			entries: {
				"memory-cloudflare-vectorize": {
					enabled: true,
				},
			},
		},
	} as unknown as OpenClawConfig;
}

type DoctorReport = {
	ok: boolean;
	checks: Array<{
		name: string;
		status: "pass" | "warn" | "fail";
		message: string;
	}>;
};

type SearchResult = {
	logicalId: string;
	namespace: string;
	title?: string;
	text: string;
	source?: string;
	metadata: Record<string, string | number | boolean>;
	score: number;
};

type CliRunResult = {
	stdout: string;
	stderr: string;
};

type ToolGetDetails =
	| {
			found: false;
	  }
	| {
			found: true;
			id: string;
			namespace: string;
			metadata: Record<string, string | number | boolean>;
	  };

type ToolSearchDetails = {
	count: number;
	records: Array<{
		id: string;
		namespace: string;
		title?: string;
		score: number;
		path: string;
	}>;
};

function extractJsonText(output: CliRunResult): string {
	for (const candidate of [output.stderr, output.stdout]) {
		const trimmed = candidate.trim();
		if (!trimmed) {
			continue;
		}
		try {
			JSON.parse(trimmed);
			return trimmed;
		} catch {
			const jsonStart = trimmed.search(/^[[{]/m);
			if (jsonStart === -1) {
				continue;
			}
			const jsonText = trimmed.slice(jsonStart).trim();
			try {
				JSON.parse(jsonText);
				return jsonText;
			} catch {
				// Keep looking through the remaining output streams.
			}
		}
	}

	throw new Error(`Expected JSON output but received\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`);
}

function parseJsonOutput<T>(output: CliRunResult): T {
	return JSON.parse(extractJsonText(output)) as T;
}

function getToolDetails<T>(result: Awaited<ReturnType<AnyAgentTool["execute"]>>): T {
	return result.details as T;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

liveDescribe("cf-memory live integration", () => {
	let tempDir: string;
	let configPath: string;
	let openClawConfig: OpenClawConfig;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cf-memory-live-"));
		configPath = join(tempDir, "openclaw.json");
		openClawConfig = createLiveOpenClawConfig();

		writeFileSync(configPath, JSON.stringify(openClawConfig));

		for (const [name, value] of Object.entries(resolvedDotEnvValues)) {
			vi.stubEnv(name, value);
		}
		vi.stubEnv("OPENCLAW_CONFIG_PATH", configPath);
		vi.stubEnv("OPENCLAW_CF_MEMORY_COMPANION_PATH", join(tempDir, "companion-store.json"));
		vi.stubEnv("OPENCLAW_DISABLE_PLUGIN_MANIFEST_CACHE", "1");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	function runOpenClawCli(args: string[]): CliRunResult {
		const result = spawnSync(process.execPath, [openClawBin, "--no-color", ...args], {
			cwd: repoRoot,
			encoding: "utf8",
			windowsHide: true,
			env: {
				...process.env,
				...resolvedDotEnvValues,
				OPENCLAW_CONFIG_PATH: configPath,
				OPENCLAW_CF_MEMORY_COMPANION_PATH: join(tempDir, "companion-store.json"),
				OPENCLAW_DISABLE_PLUGIN_MANIFEST_CACHE: "1",
			},
		});

		if (result.status !== 0) {
			throw new Error(`openclaw ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
		}

		return {
			stdout: result.stdout,
			stderr: result.stderr,
		};
	}

	function ensureIndexReady(): DoctorReport {
		const report = parseJsonOutput<DoctorReport>(runOpenClawCli(["cf-memory", "doctor", "--create-index", "--json"]));
		expect(report.ok).toBe(true);
		expect(report.checks.find((check) => check.name === "credentials")?.status).toBe("pass");
		expect(report.checks.find((check) => check.name === "workers-ai-embeddings")?.status).toBe("pass");
		expect(report.checks.find((check) => check.name === "vectorize-index")?.status).toBe("pass");
		expect(report.checks.find((check) => check.name === "dimension-match")?.status).toBe("pass");
		return report;
	}

	async function waitForSearchState(params: {
		query: string;
		namespace: string;
		logicalId: string;
		shouldExist: boolean;
		timeoutMs?: number;
		pollIntervalMs?: number;
	}): Promise<SearchResult[]> {
		const deadline = Date.now() + (params.timeoutMs ?? 240_000);
		while (Date.now() <= deadline) {
			const results = parseJsonOutput<SearchResult[]>(runOpenClawCli(["cf-memory", "search", params.query, "--namespace", params.namespace, "--limit", "5"]));
			const found = results.some((result) => result.logicalId === params.logicalId);
			if (found === params.shouldExist) {
				return results;
			}
			await delay(params.pollIntervalMs ?? 5_000);
		}

		throw new Error(`Timed out waiting for record ${params.logicalId} to ${params.shouldExist ? "appear in" : "disappear from"} search results.`);
	}

	function createLiveTools(): {
		upsertTool: AnyAgentTool;
		getTool: AnyAgentTool;
		searchTool: AnyAgentTool;
		deleteTool: AnyAgentTool;
	} {
		const registration = {
			pluginConfig: {},
			resolvePath: (input: string) => join(repoRoot, input),
		};
		const toolContext: OpenClawPluginToolContext = {
			runtimeConfig: openClawConfig,
			sessionKey: "session-1",
			agentId: "agent-1",
			workspaceDir: tempDir,
		};
		return {
			upsertTool: createUpsertTool(registration, toolContext),
			getTool: createGetTool(registration, toolContext),
			searchTool: createSearchTool(registration, toolContext),
			deleteTool: createDeleteTool(registration, toolContext),
		};
	}

	async function waitForToolGetState(params: {
		tool: AnyAgentTool;
		id: string;
		namespace?: string;
		expectedNamespace: string;
		timeoutMs?: number;
		pollIntervalMs?: number;
	}): Promise<Extract<ToolGetDetails, { found: true }>> {
		const deadline = Date.now() + (params.timeoutMs ?? 120_000);
		while (Date.now() <= deadline) {
			const result = await params.tool.execute(
				`tool-get-${randomUUID()}`,
				{
					id: params.id,
					...(params.namespace ? { namespace: params.namespace } : {}),
				},
				new AbortController().signal,
				() => {},
			);
			const details = getToolDetails<ToolGetDetails>(result);
			if (details.found && details.id === params.id && details.namespace === params.expectedNamespace) {
				return details;
			}
			await delay(params.pollIntervalMs ?? 2_000);
		}

		throw new Error(`Timed out waiting for tool get(${params.id}) to resolve in namespace ${params.expectedNamespace}.`);
	}

	async function waitForToolSearchState(params: {
		tool: AnyAgentTool;
		query: string;
		logicalId: string;
		namespace?: string;
		expectedNamespace: string;
		shouldExist: boolean;
		timeoutMs?: number;
		pollIntervalMs?: number;
	}): Promise<ToolSearchDetails> {
		const deadline = Date.now() + (params.timeoutMs ?? 120_000);
		while (Date.now() <= deadline) {
			const result = await params.tool.execute(
				`tool-search-${randomUUID()}`,
				{
					query: params.query,
					...(params.namespace ? { namespace: params.namespace } : {}),
				},
				new AbortController().signal,
				() => {},
			);
			const details = getToolDetails<ToolSearchDetails>(result);
			const match = details.records.find((record) => record.id === params.logicalId && record.namespace === params.expectedNamespace);
			if ((params.shouldExist && Boolean(match)) || (!params.shouldExist && !match)) {
				return details;
			}
			await delay(params.pollIntervalMs ?? 2_000);
		}

		throw new Error(
			`Timed out waiting for tool search(${params.query}) to ${params.shouldExist ? "return" : "clear"} ${params.logicalId} in namespace ${params.expectedNamespace}.`,
		);
	}

	it("validates the configured Cloudflare backend and creates the index if needed", () => {
		ensureIndexReady();
	}, 120_000);

	it("round-trips a record through upsert, search, and delete", async () => {
		ensureIndexReady();

		const namespacePrefix = getConfiguredValue("OPENCLAW_CF_MEMORY_TEST_NAMESPACE_PREFIX") || "cf-memory-live";
		const logicalId = `publish-check-${randomUUID()}`;
		const namespace = `${namespacePrefix}-${randomUUID()}`;
		const text = `Verify Cloudflare memory publish checks for ${logicalId}.`;

		const upserted = parseJsonOutput<{
			logicalId: string;
			namespace: string;
			title?: string;
			text: string;
			source?: string;
			metadata: Record<string, string | number | boolean>;
		}>(
			runOpenClawCli([
				"cf-memory",
				"upsert",
				text,
				"--id",
				logicalId,
				"--title",
				"Publish integration check",
				"--namespace",
				namespace,
				"--source",
				"integration-test",
				"--metadata",
				'{"topic":"release","suite":"live"}',
			]),
		);

		expect(upserted).toMatchObject({
			logicalId,
			namespace,
			title: "Publish integration check",
			text,
			source: "integration-test",
			metadata: {
				topic: "release",
				suite: "live",
			},
		});

		const matches = await waitForSearchState({
			query: logicalId,
			namespace,
			logicalId,
			shouldExist: true,
		});
		expect(matches.find((result) => result.logicalId === logicalId)).toMatchObject({
			logicalId,
			namespace,
			title: "Publish integration check",
			text,
			source: "integration-test",
			metadata: {
				topic: "release",
				suite: "live",
			},
		});

		const deleted = parseJsonOutput<{ id: string; mutationId?: string }>(runOpenClawCli(["cf-memory", "delete", logicalId, "--namespace", namespace]));
		expect(deleted.id).toBe(logicalId);

		await waitForSearchState({
			query: logicalId,
			namespace,
			logicalId,
			shouldExist: false,
		});
	}, 180_000);

	it("round-trips implicit and explicit agent-main tool namespaces", async () => {
		ensureIndexReady();

		const { upsertTool, getTool, searchTool, deleteTool } = createLiveTools();
		const logicalId = `tool-namespace-${randomUUID()}`;
		const text = `Verify implicit and explicit namespace round trips for ${logicalId}.`;
		const signal = new AbortController().signal;

		const upsertResult = await upsertTool.execute(
			`tool-upsert-${logicalId}`,
			{
				id: logicalId,
				title: "Tool namespace probe",
				text,
				source: "integration-test",
				metadata: {
					suite: "live-tools",
					probe: logicalId,
				},
			},
			signal,
			() => {},
		);
		const upsertDetails = getToolDetails<{
			id: string;
			namespace: string;
			path: string;
			mutationId?: string;
		}>(upsertResult);
		expect(upsertDetails.id).toBe(logicalId);
		expect(upsertDetails.namespace).toBe("agent-main");

		const implicitGet = await waitForToolGetState({
			tool: getTool,
			id: logicalId,
			expectedNamespace: upsertDetails.namespace,
		});
		const explicitGet = await waitForToolGetState({
			tool: getTool,
			id: logicalId,
			namespace: upsertDetails.namespace,
			expectedNamespace: upsertDetails.namespace,
		});
		expect(implicitGet.namespace).toBe(upsertDetails.namespace);
		expect(explicitGet.namespace).toBe(upsertDetails.namespace);

		const implicitSearch = await waitForToolSearchState({
			tool: searchTool,
			query: text,
			logicalId,
			expectedNamespace: upsertDetails.namespace,
			shouldExist: true,
		});
		const explicitSearch = await waitForToolSearchState({
			tool: searchTool,
			query: text,
			logicalId,
			namespace: upsertDetails.namespace,
			expectedNamespace: upsertDetails.namespace,
			shouldExist: true,
		});
		expect(implicitSearch.records.some((record) => record.id === logicalId && record.namespace === upsertDetails.namespace)).toBe(true);
		expect(explicitSearch.records.some((record) => record.id === logicalId && record.namespace === upsertDetails.namespace)).toBe(true);

		await deleteTool.execute(
			`tool-delete-${logicalId}`,
			{
				id: logicalId,
				namespace: upsertDetails.namespace,
			},
			signal,
			() => {},
		);

		await waitForToolSearchState({
			tool: searchTool,
			query: text,
			logicalId,
			namespace: upsertDetails.namespace,
			expectedNamespace: upsertDetails.namespace,
			shouldExist: false,
		});
	}, 180_000);
});

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

liveDescribe("cf-memory live integration", () => {
	let tempDir: string;
	let configPath: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cf-memory-live-"));
		configPath = join(tempDir, "openclaw.json");

		writeFileSync(
			configPath,
			JSON.stringify({
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
			}),
		);
	});

	afterEach(() => {
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
});

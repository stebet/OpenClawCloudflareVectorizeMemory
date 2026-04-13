import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const openClawBin = join(repoRoot, "node_modules", "openclaw", "openclaw.mjs");
function runOpenClawCli(args: string[]): string {
	const tempDir = mkdtempSync(join(tmpdir(), "cf-memory-cli-"));
	const configPath = join(tempDir, "openclaw.json");

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

	try {
		const result = spawnSync(process.execPath, [openClawBin, "--no-color", ...args], {
			cwd: repoRoot,
			encoding: "utf8",
			windowsHide: true,
			env: {
				...process.env,
				OPENCLAW_CONFIG_PATH: configPath,
				CLOUDFLARE_ACCOUNT_ID: "test-account",
				CLOUDFLARE_API_TOKEN: "test-token",
				CLOUDFLARE_VECTORIZE_INDEX_NAME: "test-index",
				OPENCLAW_DISABLE_PLUGIN_MANIFEST_CACHE: "1",
			},
		});

		if (result.status !== 0) {
			throw new Error(`openclaw ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
		}

		return result.stdout;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

describe("cf-memory CLI integration", () => {
	it("advertises cf-memory at the root help surface", () => {
		const output = runOpenClawCli(["--help"]);

		expect(output).toMatch(/cf-memory\s+Manage Cloudflare memory records\./);
	}, 30_000);

	it("shows init and test in cf-memory help", () => {
		const output = runOpenClawCli(["cf-memory", "--help"]);

		expect(output).toMatch(/init\s+Initialize the Cloudflare Vectorize index for the configured\s+embedding model\./);
		expect(output).toMatch(/test\s+Run an end-to-end embedding and semantic-search smoke test\./);
	}, 30_000);
});

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import hookHandler from "../hooks/cloudflare-memory-bootstrap/handler.js";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const hookDir = dirname(fileURLToPath(new URL("../hooks/cloudflare-memory-bootstrap/handler.js", import.meta.url)));
const bootstrapPath = join(hookDir, "BOOTSTRAP.md");

describe("package metadata", () => {
	it("publishes the hook-pack files and manifest entry", async () => {
		const manifest = JSON.parse(await readFile(packageJsonUrl, "utf8")) as {
			files?: string[];
			openclaw?: { hooks?: string[] };
		};

		expect(manifest.files).toContain("hooks");
		expect(manifest.openclaw?.hooks).toContain("hooks/cloudflare-memory-bootstrap");
	});
});

describe("cloudflare-memory-bootstrap hook", () => {
	it("adds packaged bootstrap guidance on agent bootstrap", async () => {
		const bootstrapFiles: string[] = [];

		await hookHandler({
			type: "agent",
			action: "bootstrap",
			context: {
				bootstrapFiles,
			},
		});

		expect(bootstrapFiles).toEqual([bootstrapPath]);
	});

	it("does not duplicate packaged bootstrap guidance", async () => {
		const bootstrapFiles = [bootstrapPath];

		await hookHandler({
			type: "agent",
			action: "bootstrap",
			context: {
				bootstrapFiles,
			},
		});

		expect(bootstrapFiles).toEqual([bootstrapPath]);
	});
});

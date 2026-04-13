import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudflareMemoryService } from "../src/service.js";

const { listMemoryFilesMock } = vi.hoisted(() => ({
	listMemoryFilesMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/memory-core", () => ({
	listMemoryFiles: listMemoryFilesMock,
}));

import { discoverMigrationFiles, parseMigrationFile, runCloudflareMemoryMigration } from "../src/migration.js";

describe("migration", () => {
	let workspaceDir: string;

	beforeEach(async () => {
		workspaceDir = await mkdtemp(join(tmpdir(), "cf-memory-migration-"));
		listMemoryFilesMock.mockReset();
	});

	afterEach(async () => {
		await rm(workspaceDir, { recursive: true, force: true });
	});

	it("parses markdown files into importable memory records", async () => {
		const filePath = join(workspaceDir, "memories", "testing-style.md");
		await mkdir(join(workspaceDir, "memories"), { recursive: true });
		await writeFile(
			filePath,
			`---
title: Testing style
topic: testing
priority: 2
active: true
---
# Heading should not win

Use Vitest for plugin tests.
`,
			"utf8",
		);

		const parsed = await parseMigrationFile({
			file: {
				absolutePath: filePath,
				relativePath: "memories/testing-style.md",
			},
			sourceMode: "paths",
			targetNamespace: "workspace-demo",
			namespaceStrategy: "single-target",
		});

		expect(parsed).not.toBeNull();
		expect(parsed?.input.id).toMatch(/^memories-testing-style-/);
		expect(parsed?.input.title).toBe("Testing style");
		expect(parsed?.input.namespace).toBe("workspace-demo");
		expect(parsed?.input.text).toBe("Use Vitest for plugin tests.");
		expect(parsed?.input.metadata).toMatchObject({
			topic: "testing",
			priority: 2,
			active: true,
			legacySourceMode: "paths",
			legacySourcePath: "memories/testing-style.md",
		});
	});

	it("discovers the default provider corpus through the OpenClaw helper", async () => {
		await mkdir(join(workspaceDir, "memory"), { recursive: true });
		await writeFile(join(workspaceDir, "memory", "note.md"), "Remember this.", "utf8");
		listMemoryFilesMock.mockResolvedValue(["memory/note.md", "memory/ignored.txt"]);

		const discovered = await discoverMigrationFiles({
			workspaceDir,
			sourceMode: "default-provider",
		});

		expect(discovered).toEqual([
			{
				absolutePath: join(workspaceDir, "memory", "note.md"),
				relativePath: "memory/note.md",
			},
		]);
	});

	it("supports dry-run migrations without writing records", async () => {
		await mkdir(join(workspaceDir, "notes"), { recursive: true });
		await writeFile(join(workspaceDir, "notes", "preference.md"), "# Preference\n\nUse spaces over tabs.\n", "utf8");

		const service = {
			resolveNamespace: vi.fn().mockReturnValue("workspace-demo"),
			doctor: vi.fn().mockResolvedValue({
				ok: true,
				checks: [{ name: "config", status: "pass", message: "ok" }],
			}),
			get: vi.fn().mockResolvedValue(null),
			upsert: vi.fn(),
		} as unknown as CloudflareMemoryService;

		const summary = await runCloudflareMemoryMigration({
			service,
			options: {
				workspaceDir,
				sourcePaths: ["notes"],
				dryRun: true,
			},
		});

		expect(summary.discoveredFiles).toBe(1);
		expect(summary.preparedRecords).toBe(1);
		expect(summary.imported).toBe(0);
		expect(summary.failed).toBe(0);
		expect(summary.results[0]).toMatchObject({
			action: "would-import",
			namespace: "workspace-demo",
		});
		expect(service.upsert).not.toHaveBeenCalled();
	});

	it("skips duplicates when requested", async () => {
		await writeFile(join(workspaceDir, "note.md"), "Keep this memory.", "utf8");

		const service = {
			resolveNamespace: vi.fn().mockReturnValue("workspace-demo"),
			doctor: vi.fn().mockResolvedValue({
				ok: true,
				checks: [{ name: "config", status: "pass", message: "ok" }],
			}),
			get: vi.fn().mockResolvedValue({
				logicalId: "note",
				vectorId: "workspace-demo::note",
				namespace: "workspace-demo",
				text: "Existing",
				metadata: {},
				path: "workspace-demo/note.md",
			}),
			upsert: vi.fn(),
		} as unknown as CloudflareMemoryService;

		const summary = await runCloudflareMemoryMigration({
			service,
			options: {
				workspaceDir,
				sourcePaths: ["note.md"],
				duplicateStrategy: "skip",
			},
		});

		expect(summary.imported).toBe(0);
		expect(summary.skipped).toBe(1);
		expect(summary.failed).toBe(0);
		expect(summary.results[0]?.action).toBe("skipped");
		expect(service.upsert).not.toHaveBeenCalled();
	});
});

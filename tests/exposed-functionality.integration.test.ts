import { join } from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { MemoryEmbeddingProviderAdapter } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_ID } from "../src/constants.js";
import { WorkersAiEmbeddingsClient } from "../src/embeddings-client.js";
import plugin from "../src/index.js";
import { CloudflareMemoryService } from "../src/service.js";
import type { ResolvedPluginConfig } from "../src/types.js";

const envToken = "env-secret-token";
const remoteToken = "remote-secret-token";
const expectedCompanionStorePath = join("C:\\plugin-root", "relative", "companion-store.json");

function createOpenClawConfig(): OpenClawConfig {
	return {
		plugins: {
			entries: {
				[PLUGIN_ID]: {
					enabled: true,
					config: {
						cloudflare: {
							accountId: "cfg-account",
							apiToken: {
								source: "env",
								provider: "default",
								id: "CF_SECRET_TOKEN",
							},
						},
						vectorize: {
							indexName: "cfg-index",
							topK: 8,
						},
						storage: {
							companionStorePath: "relative\\companion-store.json",
						},
					},
				},
			},
		},
		secrets: {
			providers: {
				default: {
					source: "env",
				},
			},
		},
	} as unknown as OpenClawConfig;
}

function expectResolvedConfig(config: ResolvedPluginConfig, overrides?: Partial<Pick<ResolvedPluginConfig, "apiToken" | "workersAiBaseUrl" | "model">>): void {
	expect(config.accountId).toBe("cfg-account");
	expect(config.indexName).toBe("cfg-index");
	expect(config.topK).toBe(8);
	expect(config.apiToken).toBe(overrides?.apiToken ?? envToken);
	expect(config.companionStorePath).toBe(expectedCompanionStorePath);
	expect(config.workersAiBaseUrl).toBe(overrides?.workersAiBaseUrl ?? "https://api.cloudflare.com/client/v4/accounts/cfg-account/ai/v1");
	expect(config.model).toBe(overrides?.model ?? "@cf/baai/bge-base-en-v1.5");
}

function readFirstText(result: Awaited<ReturnType<AnyAgentTool["execute"]>>): string {
	const [first] = result.content;
	return first?.type === "text" ? first.text : "";
}

function registerPluginSurfaces(openClawConfig: OpenClawConfig): {
	embeddingProvider: MemoryEmbeddingProviderAdapter;
	toolFactories: Map<string, (ctx: OpenClawPluginToolContext) => AnyAgentTool | AnyAgentTool[] | null | undefined>;
} {
	const toolFactories = new Map<string, (ctx: OpenClawPluginToolContext) => AnyAgentTool | AnyAgentTool[] | null | undefined>();
	let embeddingProvider: MemoryEmbeddingProviderAdapter | undefined;

	plugin.register({
		registrationMode: "full",
		pluginConfig: {},
		config: openClawConfig,
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
		registerMemoryCapability: vi.fn(),
		registerCli: vi.fn(),
		registerMemoryEmbeddingProvider: vi.fn((adapter: MemoryEmbeddingProviderAdapter) => {
			embeddingProvider = adapter;
		}),
		registerTool: vi.fn(
			(
				factory: (ctx: OpenClawPluginToolContext) => AnyAgentTool | AnyAgentTool[] | null | undefined,
				options?: {
					name?: string;
					names?: string[];
				},
			) => {
				for (const name of options?.names ?? (options?.name ? [options.name] : [])) {
					toolFactories.set(name, factory);
				}
			},
		),
		resolvePath: (input: string) => join("C:\\plugin-root", input),
	} as unknown as OpenClawPluginApi);

	if (!embeddingProvider) {
		throw new Error("Expected the plugin to register a memory embedding provider.");
	}

	return {
		embeddingProvider,
		toolFactories,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("plugin exposed functionality integration", () => {
	it("runs all registered cloudflare_memory_* tools with the shared config/path resolution flow", async () => {
		vi.stubEnv("CF_SECRET_TOKEN", envToken);
		const openClawConfig = createOpenClawConfig();
		const { toolFactories } = registerPluginSurfaces(openClawConfig);
		const toolContext: OpenClawPluginToolContext = {
			runtimeConfig: openClawConfig,
			agentId: "agent-1",
			sessionKey: "session-1",
			workspaceDir: "D:\\workspace",
		};

		vi.spyOn(CloudflareMemoryService.prototype, "search").mockImplementation(async function (this: CloudflareMemoryService, params) {
			expectResolvedConfig(this.config);
			expect(params).toMatchObject({
				query: "release checks",
				filter: { topic: "release" },
				sessionKey: "session-1",
				agentId: "agent-1",
				workspaceDir: "D:\\workspace",
			});
			return [
				{
					logicalId: "publish-check",
					vectorId: "release::publish-check",
					namespace: "release",
					title: "Publish integration check",
					text: "Verify Cloudflare memory publish checks.",
					metadata: { topic: "release" },
					path: "release/publish-check.md",
					score: 0.99,
				},
			];
		});
		vi.spyOn(CloudflareMemoryService.prototype, "get").mockImplementation(async function (this: CloudflareMemoryService, params) {
			expectResolvedConfig(this.config);
			expect(params).toMatchObject({
				id: "publish-check",
				namespace: "release",
				sessionKey: "session-1",
				agentId: "agent-1",
				workspaceDir: "D:\\workspace",
			});
			return {
				logicalId: "publish-check",
				vectorId: "release::publish-check",
				namespace: "release",
				title: "Publish integration check",
				text: "Verify Cloudflare memory publish checks.",
				metadata: { topic: "release" },
				path: "release/publish-check.md",
			};
		});
		vi.spyOn(CloudflareMemoryService.prototype, "upsert").mockImplementation(async function (this: CloudflareMemoryService, params) {
			expectResolvedConfig(this.config);
			expect(params).toMatchObject({
				sessionKey: "session-1",
				agentId: "agent-1",
				workspaceDir: "D:\\workspace",
				input: {
					id: "publish-check",
					title: "Publish integration check",
					text: "Verify Cloudflare memory publish checks.",
					namespace: "release",
					source: "integration-test",
					metadata: {
						topic: "release",
					},
				},
			});
			return {
				logicalId: "publish-check",
				vectorId: "release::publish-check",
				namespace: "release",
				title: "Publish integration check",
				text: "Verify Cloudflare memory publish checks.",
				metadata: { topic: "release" },
				path: "release/publish-check.md",
				mutationId: "mutation-1",
			};
		});
		vi.spyOn(CloudflareMemoryService.prototype, "delete").mockImplementation(async function (this: CloudflareMemoryService, params) {
			expectResolvedConfig(this.config);
			expect(params).toMatchObject({
				id: "publish-check",
				namespace: "release",
				sessionKey: "session-1",
				agentId: "agent-1",
				workspaceDir: "D:\\workspace",
			});
			return "mutation-1";
		});

		const searchToolFactory = toolFactories.get("cloudflare_memory_search");
		const getToolFactory = toolFactories.get("cloudflare_memory_get");
		const upsertToolFactory = toolFactories.get("cloudflare_memory_upsert");
		const deleteToolFactory = toolFactories.get("cloudflare_memory_delete");
		expect(searchToolFactory && getToolFactory && upsertToolFactory && deleteToolFactory).toBeTruthy();

		const signal = new AbortController().signal;
		const searchTool = searchToolFactory?.(toolContext) as AnyAgentTool;
		const getTool = getToolFactory?.(toolContext) as AnyAgentTool;
		const upsertTool = upsertToolFactory?.(toolContext) as AnyAgentTool;
		const deleteTool = deleteToolFactory?.(toolContext) as AnyAgentTool;

		const searchResult = await searchTool.execute(
			"tool-call-search",
			{
				query: "release checks",
				filterJson: '{"topic":"release"}',
			},
			signal,
			vi.fn(),
		);
		expect(searchResult).toMatchObject({
			details: {
				count: 1,
				records: [
					{
						id: "publish-check",
						namespace: "release",
						title: "Publish integration check",
						score: 0.99,
						path: "release/publish-check.md",
					},
				],
			},
		});
		expect(readFirstText(searchResult)).toContain("Publish integration check");

		const getResult = await getTool.execute(
			"tool-call-get",
			{
				id: "publish-check",
				namespace: "release",
			},
			signal,
			vi.fn(),
		);
		expect(getResult).toMatchObject({
			details: {
				found: true,
				id: "publish-check",
				namespace: "release",
				metadata: {
					topic: "release",
				},
			},
		});
		expect(readFirstText(getResult)).toContain("release/publish-check.md");

		const upsertResult = await upsertTool.execute(
			"tool-call-upsert",
			{
				id: "publish-check",
				title: "Publish integration check",
				text: "Verify Cloudflare memory publish checks.",
				namespace: "release",
				source: "integration-test",
				metadata: {
					topic: "release",
				},
			},
			signal,
			vi.fn(),
		);
		expect(upsertResult).toMatchObject({
			details: {
				id: "publish-check",
				namespace: "release",
				path: "release/publish-check.md",
				mutationId: "mutation-1",
			},
		});
		expect(readFirstText(upsertResult)).toContain("Stored memory publish-check");

		const deleteResult = await deleteTool.execute(
			"tool-call-delete",
			{
				id: "publish-check",
				namespace: "release",
			},
			signal,
			vi.fn(),
		);
		expect(deleteResult).toMatchObject({
			details: {
				mutationId: "mutation-1",
			},
		});
		expect(readFirstText(deleteResult)).toContain("Deleted memory publish-check.");
	});

	it("runs the registered embedding provider with the same config/path resolution flow and remote overrides", async () => {
		vi.stubEnv("CF_SECRET_TOKEN", envToken);
		const openClawConfig = createOpenClawConfig();
		const { embeddingProvider } = registerPluginSurfaces(openClawConfig);

		vi.spyOn(WorkersAiEmbeddingsClient.prototype, "embedQuery").mockImplementation(async function (this: WorkersAiEmbeddingsClient, text) {
			expectResolvedConfig((this as unknown as { config: ResolvedPluginConfig }).config, {
				apiToken: remoteToken,
				workersAiBaseUrl: "https://workers.example.test/ai/v1",
				model: "@cf/custom/embedding-model",
			});
			return [text.length, 1];
		});
		vi.spyOn(WorkersAiEmbeddingsClient.prototype, "embedBatch").mockImplementation(async function (this: WorkersAiEmbeddingsClient, texts) {
			expectResolvedConfig((this as unknown as { config: ResolvedPluginConfig }).config, {
				apiToken: remoteToken,
				workersAiBaseUrl: "https://workers.example.test/ai/v1",
				model: "@cf/custom/embedding-model",
			});
			return texts.map((text) => [text.length]);
		});

		const created = await embeddingProvider.create({
			config: openClawConfig,
			model: "@cf/custom/embedding-model",
			remote: {
				apiKey: remoteToken,
				baseUrl: "https://workers.example.test/ai/v1",
			},
		});

		expect(created.provider).not.toBeNull();
		expect(created.provider?.model).toBe("@cf/custom/embedding-model");
		expect(created.runtime).toMatchObject({
			id: "cloudflare-workers-ai",
			cacheKeyData: {
				accountId: "cfg-account",
				model: "@cf/custom/embedding-model",
			},
		});
		await expect(created.provider?.embedQuery("hello")).resolves.toEqual([5, 1]);
		await expect(created.provider?.embedBatch(["a", "bb"])).resolves.toEqual([[1], [2]]);
	});
});

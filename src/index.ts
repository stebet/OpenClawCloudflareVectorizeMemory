import type { MemoryEmbeddingProviderAdapter } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { registerCloudflareMemoryCli } from "./cli.js";
import { pluginConfigSchema } from "./config.js";
import { CLI_ROOT_COMMAND, CLI_ROOT_DESCRIPTOR, DEFAULT_EMBEDDING_MODEL, PLUGIN_DESCRIPTION, PLUGIN_ID, PLUGIN_NAME } from "./constants.js";
import { buildPromptSection } from "./prompt.js";
import { createPublicArtifactsProvider } from "./public-artifacts.js";
import { createMemoryRuntime } from "./runtime.js";
import { createCloudflareMemoryService, resolveCloudflareMemoryServiceConfig } from "./service-factory.js";
import { createDeleteTool, createGetTool, createSearchTool, createUpsertTool } from "./tools.js";

function pickTrimmed(value: string | undefined): string | undefined {
	return value && value.trim().length > 0 ? value.trim() : undefined;
}

function createMemoryEmbeddingProviderAdapter(params: { pluginConfig: unknown; resolvePath?: (input: string) => string }): MemoryEmbeddingProviderAdapter {
	return {
		id: "cloudflare-workers-ai",
		defaultModel: DEFAULT_EMBEDDING_MODEL,
		transport: "remote",
		allowExplicitWhenConfiguredAuto: true,
		async create(options) {
			const service = await createCloudflareMemoryService({
				pluginConfig: params.pluginConfig,
				openClawConfig: options.config,
				env: process.env,
				resolvePath: params.resolvePath,
				overrides: {
					model: options.model || undefined,
					workersAiBaseUrl: pickTrimmed(options.remote?.baseUrl),
					apiToken: typeof options.remote?.apiKey === "string" ? pickTrimmed(options.remote.apiKey) : undefined,
				},
			});
			return {
				provider: {
					id: "cloudflare-workers-ai",
					model: service.config.model,
					embedQuery: (text) => service.embeddings.embedQuery(text),
					embedBatch: (texts) => service.embeddings.embedBatch(texts),
				},
				runtime: {
					id: "cloudflare-workers-ai",
					cacheKeyData: {
						accountId: service.config.accountId,
						model: service.config.model,
					},
				},
			};
		},
	};
}

function registerCloudflareMemoryCliEntry(api: Pick<OpenClawPluginApi, "registerCli" | "pluginConfig" | "config" | "resolvePath" | "registrationMode">): void {
	api.registerCli(
		({ program }) => {
			registerCloudflareMemoryCli(program, {
				pluginConfig: api.pluginConfig,
				openClawConfig: api.config,
				resolvePath: api.resolvePath,
			});
		},
		api.registrationMode === "cli-metadata"
			? {
					descriptors: [CLI_ROOT_DESCRIPTOR],
				}
			: {
					commands: [CLI_ROOT_COMMAND],
				},
	);
}

export default definePluginEntry({
	id: PLUGIN_ID,
	name: PLUGIN_NAME,
	description: PLUGIN_DESCRIPTION,
	kind: "memory",
	configSchema: pluginConfigSchema,
	register(api: OpenClawPluginApi) {
		pluginConfigSchema.parse?.(api.pluginConfig ?? {});

		registerCloudflareMemoryCliEntry(api);

		if (
			api.registrationMode === "cli-metadata" ||
			typeof api.registerMemoryEmbeddingProvider !== "function" ||
			typeof api.registerMemoryCapability !== "function" ||
			typeof api.registerTool !== "function"
		) {
			return;
		}

		api.registerMemoryEmbeddingProvider(
			createMemoryEmbeddingProviderAdapter({
				pluginConfig: api.pluginConfig,
				resolvePath: api.resolvePath,
			}),
		);
		api.registerMemoryCapability({
			promptBuilder: buildPromptSection,
			runtime: createMemoryRuntime({
				pluginConfig: api.pluginConfig,
				resolvePath: api.resolvePath,
			}),
			publicArtifacts: createPublicArtifactsProvider(api.pluginConfig, api.resolvePath),
		});

		api.registerTool(
			(ctx) =>
				createSearchTool(
					{
						pluginConfig: api.pluginConfig,
						resolvePath: api.resolvePath,
					},
					ctx,
				),
			{
				names: ["cloudflare_memory_search"],
			},
		);
		api.registerTool(
			(ctx) =>
				createGetTool(
					{
						pluginConfig: api.pluginConfig,
						resolvePath: api.resolvePath,
					},
					ctx,
				),
			{
				names: ["cloudflare_memory_get"],
			},
		);
		api.registerTool(
			(ctx) =>
				createUpsertTool(
					{
						pluginConfig: api.pluginConfig,
						resolvePath: api.resolvePath,
					},
					ctx,
				),
			{
				names: ["cloudflare_memory_upsert"],
			},
		);
		api.registerTool(
			(ctx) =>
				createDeleteTool(
					{
						pluginConfig: api.pluginConfig,
						resolvePath: api.resolvePath,
					},
					ctx,
				),
			{
				names: ["cloudflare_memory_delete"],
			},
		);

		void resolveCloudflareMemoryServiceConfig({
			pluginConfig: api.pluginConfig,
			openClawConfig: api.config,
			env: process.env,
			resolvePath: api.resolvePath,
		})
			.then((resolved) => {
				api.logger.info(`${PLUGIN_ID}: registered for index ${resolved.indexName} using model ${resolved.model}.`);
			})
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : "Unknown configuration error.";
				api.logger.warn(`${PLUGIN_ID}: deferred config validation reported: ${message}`);
			});
	},
});

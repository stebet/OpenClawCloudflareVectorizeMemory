import type { MemoryEmbeddingProviderAdapter } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { registerCloudflareMemoryCli } from "./cli.js";
import { getPluginConfigFromOpenClawConfig, pluginConfigSchema, resolvePluginConfig } from "./config.js";
import { DEFAULT_EMBEDDING_MODEL, PLUGIN_DESCRIPTION, PLUGIN_ID, PLUGIN_NAME } from "./constants.js";
import { buildPromptSection } from "./prompt.js";
import { createPublicArtifactsProvider } from "./public-artifacts.js";
import { createMemoryRuntime } from "./runtime.js";
import { CloudflareMemoryService } from "./service.js";
import { createDeleteTool, createGetTool, createSearchTool, createUpsertTool } from "./tools.js";

function createMemoryEmbeddingProviderAdapter(): MemoryEmbeddingProviderAdapter {
	return {
		id: "cloudflare-workers-ai",
		defaultModel: DEFAULT_EMBEDDING_MODEL,
		transport: "remote",
		allowExplicitWhenConfiguredAuto: true,
		async create(options) {
			const pluginConfig = getPluginConfigFromOpenClawConfig(options.config);
			const resolved = await resolvePluginConfig({
				pluginConfig,
				openClawConfig: options.config,
				env: process.env,
			});
			const service = new CloudflareMemoryService(
				{
					...resolved,
					model: options.model || resolved.model,
					workersAiBaseUrl: options.remote?.baseUrl && options.remote.baseUrl.trim().length > 0 ? options.remote.baseUrl : resolved.workersAiBaseUrl,
					apiToken: typeof options.remote?.apiKey === "string" && options.remote.apiKey.trim().length > 0 ? options.remote.apiKey : resolved.apiToken,
				},
				options.config,
			);
			return {
				provider: {
					id: "cloudflare-workers-ai",
					model: options.model || resolved.model,
					embedQuery: (text) => service.embeddings.embedQuery(text),
					embedBatch: (texts) => service.embeddings.embedBatch(texts),
				},
				runtime: {
					id: "cloudflare-workers-ai",
					cacheKeyData: {
						accountId: resolved.accountId,
						model: options.model || resolved.model,
					},
				},
			};
		},
	};
}

function registerCloudflareMemoryCliEntry(api: Pick<OpenClawPluginApi, "registerCli" | "pluginConfig" | "config" | "resolvePath">): void {
	api.registerCli(
		({ program }) => {
			registerCloudflareMemoryCli(program, {
				pluginConfig: api.pluginConfig,
				openClawConfig: api.config,
				resolvePath: api.resolvePath,
			});
		},
		{
			descriptors: [
				{
					name: "cf-memory",
					description: "Manage Cloudflare Vectorize memory",
					hasSubcommands: true,
				},
			],
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

		api.registerMemoryEmbeddingProvider(createMemoryEmbeddingProviderAdapter());
		api.registerMemoryCapability({
			promptBuilder: buildPromptSection,
			runtime: createMemoryRuntime({
				pluginConfig: api.pluginConfig,
				resolvePath: api.resolvePath,
			}),
			publicArtifacts: createPublicArtifactsProvider(api.pluginConfig, api.resolvePath),
		});

		api.registerTool((ctx) => createSearchTool(api.pluginConfig, ctx), {
			names: ["cloudflare_memory_search"],
		});
		api.registerTool((ctx) => createGetTool(api.pluginConfig, ctx), {
			names: ["cloudflare_memory_get"],
		});
		api.registerTool((ctx) => createUpsertTool(api.pluginConfig, ctx), {
			names: ["cloudflare_memory_upsert"],
		});
		api.registerTool((ctx) => createDeleteTool(api.pluginConfig, ctx), {
			names: ["cloudflare_memory_delete"],
		});

		void resolvePluginConfig({
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

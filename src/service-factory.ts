import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { getPluginConfigFromOpenClawConfig, normalizePluginConfigInput, resolvePluginConfig } from "./config.js";
import { CloudflareMemoryService } from "./service.js";
import type { RawPluginConfig, ResolvedPluginConfig } from "./types.js";

type ServiceConfigOverrides = Partial<Pick<ResolvedPluginConfig, "apiToken" | "workersAiBaseUrl" | "model">>;

function hasConfiguredPluginValues(config: RawPluginConfig): boolean {
	return config.cloudflare !== undefined || config.vectorize !== undefined || config.embeddings !== undefined || config.storage !== undefined;
}

function resolveServicePluginConfig(params: { pluginConfig?: unknown; openClawConfig: OpenClawConfig }): RawPluginConfig {
	const configuredFromOpenClaw = getPluginConfigFromOpenClawConfig(params.openClawConfig);
	if (hasConfiguredPluginValues(configuredFromOpenClaw)) {
		return configuredFromOpenClaw;
	}
	return normalizePluginConfigInput(params.pluginConfig);
}

export async function resolveCloudflareMemoryServiceConfig(params: {
	pluginConfig?: unknown;
	openClawConfig: OpenClawConfig;
	env?: NodeJS.ProcessEnv;
	resolvePath?: (input: string) => string;
	overrides?: ServiceConfigOverrides;
}): Promise<ResolvedPluginConfig> {
	const resolved = await resolvePluginConfig({
		pluginConfig: resolveServicePluginConfig(params),
		openClawConfig: params.openClawConfig,
		env: params.env,
		resolvePath: params.resolvePath,
	});

	return {
		...resolved,
		...(params.overrides?.apiToken !== undefined ? { apiToken: params.overrides.apiToken } : {}),
		...(params.overrides?.workersAiBaseUrl !== undefined ? { workersAiBaseUrl: params.overrides.workersAiBaseUrl } : {}),
		...(params.overrides?.model !== undefined ? { model: params.overrides.model } : {}),
	};
}

export async function createCloudflareMemoryService(params: {
	pluginConfig?: unknown;
	openClawConfig: OpenClawConfig;
	env?: NodeJS.ProcessEnv;
	resolvePath?: (input: string) => string;
	overrides?: ServiceConfigOverrides;
}): Promise<CloudflareMemoryService> {
	const resolved = await resolveCloudflareMemoryServiceConfig(params);
	return new CloudflareMemoryService(resolved, params.openClawConfig);
}

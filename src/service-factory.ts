import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { resolvePluginConfig } from "./config.js";
import { CloudflareMemoryService } from "./service.js";

export async function createCloudflareMemoryService(params: {
	pluginConfig: unknown;
	openClawConfig: OpenClawConfig;
	env?: NodeJS.ProcessEnv;
	resolvePath?: (input: string) => string;
}): Promise<CloudflareMemoryService> {
	const resolved = await resolvePluginConfig(params);
	return new CloudflareMemoryService(resolved, params.openClawConfig);
}

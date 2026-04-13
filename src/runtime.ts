import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { MemoryPluginRuntime } from "openclaw/plugin-sdk/memory-core";
import { CloudflareMemorySearchManager } from "./search-manager.js";
import { createCloudflareMemoryService } from "./service-factory.js";

export function createMemoryRuntime(params: { pluginConfig: unknown; resolvePath?: (input: string) => string }): MemoryPluginRuntime {
	const managers = new Map<string, CloudflareMemorySearchManager>();

	async function getOrCreateManager(openClawConfig: OpenClawConfig, agentId: string): Promise<CloudflareMemorySearchManager> {
		const service = await createCloudflareMemoryService({
			pluginConfig: params.pluginConfig,
			openClawConfig,
			env: process.env,
			resolvePath: params.resolvePath,
		});
		const key = `${agentId}::${service.config.indexName}::${service.config.storageMode}`;
		const existing = managers.get(key);
		if (existing) {
			return existing;
		}
		const manager = new CloudflareMemorySearchManager(service, agentId);
		managers.set(key, manager);
		return manager;
	}

	return {
		async getMemorySearchManager(params) {
			try {
				const manager = await getOrCreateManager(params.cfg, params.agentId);
				return { manager };
			} catch (error) {
				return {
					manager: null,
					error: error instanceof Error ? error.message : "Unable to create Cloudflare memory manager.",
				};
			}
		},
		resolveMemoryBackendConfig() {
			return { backend: "builtin" };
		},
		async closeAllMemorySearchManagers() {
			await Promise.all([...managers.values()].map((manager) => manager.close?.()));
			managers.clear();
		},
	};
}

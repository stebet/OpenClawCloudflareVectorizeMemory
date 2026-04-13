import { access } from "node:fs/promises";
import { dirname } from "node:path";
import type { MemoryPluginPublicArtifact, MemoryPluginPublicArtifactsProvider } from "openclaw/plugin-sdk/memory-core";
import { createCloudflareMemoryService } from "./service-factory.js";

export function createPublicArtifactsProvider(pluginConfig: unknown, resolvePath?: (input: string) => string): MemoryPluginPublicArtifactsProvider {
	return {
		async listArtifacts({ cfg }): Promise<MemoryPluginPublicArtifact[]> {
			const service = await createCloudflareMemoryService({
				pluginConfig,
				openClawConfig: cfg,
				env: process.env,
				resolvePath,
			});
			const config = service.config;
			try {
				await access(config.companionStorePath);
			} catch {
				return [];
			}
			return [
				{
					kind: "cloudflare-companion-store",
					workspaceDir: dirname(config.companionStorePath),
					relativePath: config.companionStorePath.split(/[/\\]/).at(-1) ?? "companion-store.json",
					absolutePath: config.companionStorePath,
					agentIds: [],
					contentType: "json",
				},
			];
		},
	};
}

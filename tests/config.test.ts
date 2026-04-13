import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPluginConfigFromOpenClawConfig, resolvePluginConfig } from "../src/config.js";
import { PLUGIN_ID } from "../src/constants.js";

describe("resolvePluginConfig", () => {
	it("prefers explicit plugin config over env for non-secret values", async () => {
		const resolved = await resolvePluginConfig({
			pluginConfig: {
				cloudflare: {
					accountId: "cfg-account",
					apiToken: "cfg-token",
				},
				vectorize: {
					indexName: "cfg-index",
					topK: 8,
				},
				embeddings: {
					model: "@cf/qwen/qwen3-embedding-0.6b",
				},
			},
			openClawConfig: {} as never,
			env: {
				CLOUDFLARE_ACCOUNT_ID: "env-account",
				CLOUDFLARE_API_TOKEN: "env-token",
				CLOUDFLARE_VECTORIZE_INDEX_NAME: "env-index",
			},
			resolvePath: (input) => input,
		});

		expect(resolved.accountId).toBe("cfg-account");
		expect(resolved.apiToken).toBe("cfg-token");
		expect(resolved.indexName).toBe("cfg-index");
		expect(resolved.topK).toBe(8);
		expect(resolved.model).toBe("@cf/qwen/qwen3-embedding-0.6b");
	});

	it("resolves API token from an env secret ref", async () => {
		const resolved = await resolvePluginConfig({
			pluginConfig: {
				cloudflare: {
					accountId: "cfg-account",
					apiToken: {
						source: "env",
						provider: "default",
						id: "MY_CF_TOKEN",
					},
				},
				vectorize: {
					indexName: "cfg-index",
				},
			},
			openClawConfig: {
				plugins: {
					entries: {
						[PLUGIN_ID]: {
							cloudflare: {
								apiToken: {
									source: "env",
									provider: "default",
									id: "MY_CF_TOKEN",
								},
							},
							vectorize: {
								indexName: "cfg-index",
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
			} as never,
			env: {
				MY_CF_TOKEN: "secret-token",
			},
			resolvePath: (input) => input,
		});

		expect(resolved.apiToken).toBe("secret-token");
	});

	it("unwraps wrapped plugin entries from the OpenClaw config and resolves relative companion paths", async () => {
		const openClawConfig = {
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
									id: "MY_CF_TOKEN",
								},
							},
							vectorize: {
								indexName: "cfg-index",
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
		} as never;

		const pluginConfig = getPluginConfigFromOpenClawConfig(openClawConfig);
		expect(pluginConfig).toMatchObject({
			cloudflare: {
				accountId: "cfg-account",
			},
			vectorize: {
				indexName: "cfg-index",
			},
			storage: {
				companionStorePath: "relative\\companion-store.json",
			},
		});

		const resolved = await resolvePluginConfig({
			pluginConfig,
			openClawConfig,
			env: {
				MY_CF_TOKEN: "secret-token",
			},
			resolvePath: (input) => join("C:\\plugin-root", input),
		});

		expect(resolved.apiToken).toBe("secret-token");
		expect(resolved.companionStorePath).toBe(join("C:\\plugin-root", "relative\\companion-store.json"));
	});
});

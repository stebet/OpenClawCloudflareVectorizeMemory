import { describe, expect, it } from "vitest";
import { resolvePluginConfig } from "../src/config.js";
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
});

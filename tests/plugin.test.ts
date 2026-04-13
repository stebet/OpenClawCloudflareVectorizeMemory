import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";
import plugin from "../src/index.js";
import { CLI_ROOT_DESCRIPTOR } from "../src/constants.js";

describe("plugin registration", () => {
	it("registers memory capability, embedding provider, tools, and cli in full mode", () => {
		const registerMemoryCapability = vi.fn();
		const registerMemoryEmbeddingProvider = vi.fn();
		const registerTool = vi.fn();
		const registerCli = vi.fn();
		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		const api = {
			registrationMode: "full",
			pluginConfig: {
				cloudflare: {
					accountId: "account",
					apiToken: "token",
				},
				vectorize: {
					indexName: "memory",
				},
			},
			config: {} as never,
			logger,
			registerMemoryCapability,
			registerMemoryEmbeddingProvider,
			registerTool,
			registerCli,
			resolvePath: (input: string) => input,
		} as unknown as OpenClawPluginApi;

		expect(plugin.kind).toBe("memory");
		plugin.register(api);

		expect(registerMemoryEmbeddingProvider).toHaveBeenCalledTimes(1);
		expect(registerMemoryCapability).toHaveBeenCalledTimes(1);
		expect(registerTool).toHaveBeenCalledTimes(4);
		expect(registerCli).toHaveBeenCalledTimes(1);
		expect(registerCli).toHaveBeenCalledWith(expect.any(Function), {
			descriptors: [CLI_ROOT_DESCRIPTOR],
		});
	});

	it("registers only cli metadata when loaded without memory handlers", () => {
		const registerCli = vi.fn();
		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		const api = {
			registrationMode: "cli-metadata",
			pluginConfig: {},
			config: {} as never,
			logger,
			registerCli,
			resolvePath: (input: string) => input,
		} as unknown as OpenClawPluginApi;

		expect(() => plugin.register(api)).not.toThrow();
		expect(registerCli).toHaveBeenCalledTimes(1);
		expect(registerCli).toHaveBeenCalledWith(expect.any(Function), {
			descriptors: [CLI_ROOT_DESCRIPTOR],
		});
	});
});

import { describe, expect, it, vi } from "vitest";
import cliMetadataEntry from "../cli-metadata.ts";

describe("cli metadata entry", () => {
	it("registers the cf-memory descriptor without full runtime handlers", () => {
		const registerCli = vi.fn();

		expect(cliMetadataEntry.id).toBe("memory-cloudflare-vectorize");
		expect(() =>
			cliMetadataEntry.register({
				registrationMode: "cli-metadata",
				registerCli,
			} as never),
		).not.toThrow();

		expect(registerCli).toHaveBeenCalledWith(expect.any(Function), {
			descriptors: [
				{
					name: "cf-memory",
					description: "Manage Cloudflare Vectorize memory",
					hasSubcommands: true,
				},
			],
		});
	});
});

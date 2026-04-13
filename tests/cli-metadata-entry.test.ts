import { describe, expect, it, vi } from "vitest";
import cliMetadataEntry from "../cli-metadata.ts";

class FakeCommand {
	readonly children: FakeCommand[] = [];

	constructor(readonly name: string) {}

	command(name: string): FakeCommand {
		const child = new FakeCommand(name);
		this.children.push(child);
		return child;
	}

	description(_description: string): FakeCommand {
		return this;
	}

	argument(_name: string, _description: string): FakeCommand {
		return this;
	}

	option(_flags: string, _description: string): FakeCommand {
		return this;
	}

	action(_handler: (...args: unknown[]) => Promise<void> | void): FakeCommand {
		return this;
	}

	opts(): Record<string, unknown> {
		return {};
	}
}

describe("cli metadata entry", () => {
	it("registers the cf-memory descriptor and lazy CLI registrar", async () => {
		const registerCli = vi.fn();

		expect(cliMetadataEntry.id).toBe("memory-cloudflare-vectorize");
		expect(() =>
			cliMetadataEntry.register({
				registrationMode: "cli-metadata",
				pluginConfig: {},
				config: {},
				resolvePath: (input: string) => input,
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

		const registrar = registerCli.mock.calls[0]?.[0] as ((ctx: { program: { command: (name: string) => FakeCommand } }) => Promise<void>) | undefined;
		expect(registrar).toBeTypeOf("function");

		const roots: FakeCommand[] = [];
		await registrar?.({
			program: {
				command(name: string) {
					const root = new FakeCommand(name);
					roots.push(root);
					return root;
				},
			},
		});

		const root = roots[0];
		expect(root?.name).toBe("cf-memory");
		expect(root?.children.map((child) => child.name)).toEqual(["doctor", "init", "test", "search", "upsert", "delete", "migrate"]);
	});
});

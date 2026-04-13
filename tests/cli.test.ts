import { describe, expect, it } from "vitest";
import { registerCloudflareMemoryCli } from "../src/cli.js";

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

describe("registerCloudflareMemoryCli", () => {
	it("registers the migration subcommand", () => {
		const roots: FakeCommand[] = [];
		registerCloudflareMemoryCli(
			{
				command(name: string) {
					const root = new FakeCommand(name);
					roots.push(root);
					return root;
				},
			},
			{
				pluginConfig: {},
				openClawConfig: {} as never,
			},
		);

		const root = roots[0];
		expect(root?.name).toBe("cf-memory");
		expect(root?.children.map((child) => child.name)).toEqual(["doctor", "search", "upsert", "delete", "migrate"]);
	});
});

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
	id: "memory-cloudflare-vectorize",
	name: "Cloudflare Vectorize Memory",
	description: "OpenClaw memory plugin backed by Cloudflare Vectorize and Workers AI embeddings.",
	register(api) {
		api.registerCli(() => {}, {
			descriptors: [
				{
					name: "cf-memory",
					description: "Manage Cloudflare Vectorize memory",
					hasSubcommands: true,
				},
			],
		});
	},
});

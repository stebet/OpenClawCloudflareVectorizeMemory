import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/memory-core";

export const buildPromptSection: MemoryPromptSectionBuilder = ({ availableTools }) => {
	const lines = [
		"Cloudflare memory is available through Vectorize semantic search and Workers AI embeddings.",
		"Use the memory tools for recalling past facts, preferences, and durable notes before asking repetitive follow-up questions.",
	];

	if (availableTools.has("cloudflare_memory_upsert")) {
		lines.push("When the user wants something remembered long-term, store it with cloudflare_memory_upsert.");
	}
	if (availableTools.has("cloudflare_memory_search")) {
		lines.push("Use cloudflare_memory_search to retrieve prior memories by semantic similarity or metadata filters.");
	}

	return lines;
};

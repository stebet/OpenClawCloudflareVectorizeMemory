import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import type { CloudflareMemoryService } from "./service.js";
import { createCloudflareMemoryService } from "./service-factory.js";
import type { MetadataFilter, MetadataValue } from "./types.js";

async function buildService(pluginConfig: unknown, ctx: OpenClawPluginToolContext): Promise<CloudflareMemoryService> {
	const runtimeConfig = ctx.runtimeConfig ?? ctx.config;
	if (!runtimeConfig) {
		throw new Error("Cloudflare memory tools require an OpenClaw runtime config.");
	}
	return createCloudflareMemoryService({
		pluginConfig,
		openClawConfig: runtimeConfig,
		env: process.env,
	});
}

function parseJsonObject<T>(value: string | undefined, label: string): T | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = JSON.parse(value) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${label} must be a JSON object.`);
	}
	return parsed as T;
}

const metadataValueSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);

function textResult<TDetails>(text: string, details: TDetails) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

export function createSearchTool(pluginConfig: unknown, ctx: OpenClawPluginToolContext): AnyAgentTool {
	return {
		name: "cloudflare_memory_search",
		label: "Cloudflare Memory Search",
		description: "Search Cloudflare-backed memory records using semantic retrieval.",
		parameters: Type.Object({
			query: Type.String({ description: "Semantic search query." }),
			namespace: Type.Optional(Type.String({ description: "Optional namespace override." })),
			maxResults: Type.Optional(Type.Number({ description: "Maximum results to return." })),
			minScore: Type.Optional(Type.Number({ description: "Minimum similarity score from 0 to 1." })),
			filterJson: Type.Optional(Type.String({ description: "Optional JSON object for Vectorize metadata filtering." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate) {
			const service = await buildService(pluginConfig, ctx);
			const filter = parseJsonObject<MetadataFilter>(params.filterJson as string | undefined, "filterJson");
			const records = await service.search({
				query: params.query as string,
				namespace: params.namespace as string | undefined,
				maxResults: params.maxResults as number | undefined,
				minScore: params.minScore as number | undefined,
				filter,
				sessionKey: ctx.sessionKey,
				agentId: ctx.agentId,
				workspaceDir: ctx.workspaceDir,
			});
			if (records.length === 0) {
				return textResult("No matching memories found.", { count: 0, records: [] });
			}
			const text = records
				.map((record, index) => `${index + 1}. [${record.namespace}] ${record.title ?? record.logicalId} (${record.score.toFixed(3)})\n${record.text}`)
				.join("\n\n");
			return textResult(text, {
				count: records.length,
				records: records.map((record) => ({
					id: record.logicalId,
					namespace: record.namespace,
					title: record.title,
					score: record.score,
					path: record.path,
				})),
			});
		},
	};
}

export function createGetTool(pluginConfig: unknown, ctx: OpenClawPluginToolContext): AnyAgentTool {
	return {
		name: "cloudflare_memory_get",
		label: "Cloudflare Memory Get",
		description: "Get a Cloudflare-backed memory record by id.",
		parameters: Type.Object({
			id: Type.String({ description: "Logical memory record id." }),
			namespace: Type.Optional(Type.String({ description: "Optional namespace override." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate) {
			const service = await buildService(pluginConfig, ctx);
			const record = await service.get({
				id: params.id as string,
				namespace: params.namespace as string | undefined,
				sessionKey: ctx.sessionKey,
				agentId: ctx.agentId,
				workspaceDir: ctx.workspaceDir,
			});
			if (!record) {
				return textResult("Memory record not found.", { found: false });
			}
			return textResult(`${record.title ?? record.logicalId}\nNamespace: ${record.namespace}\nPath: ${record.path}\n\n${record.text}`, {
				found: true,
				id: record.logicalId,
				namespace: record.namespace,
				metadata: record.metadata,
			});
		},
	};
}

export function createUpsertTool(pluginConfig: unknown, ctx: OpenClawPluginToolContext): AnyAgentTool {
	return {
		name: "cloudflare_memory_upsert",
		label: "Cloudflare Memory Upsert",
		description: "Insert or update a Cloudflare-backed memory record.",
		parameters: Type.Object({
			id: Type.Optional(Type.String({ description: "Optional stable logical id." })),
			title: Type.Optional(Type.String({ description: "Optional title." })),
			text: Type.String({ description: "Memory text to store." }),
			namespace: Type.Optional(Type.String({ description: "Optional namespace override." })),
			source: Type.Optional(Type.String({ description: "Optional source label." })),
			metadata: Type.Optional(
				Type.Record(Type.String(), metadataValueSchema, {
					description: "Flat metadata object with string, number, or boolean values.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate) {
			const service = await buildService(pluginConfig, ctx);
			const record = await service.upsert({
				input: {
					id: params.id as string | undefined,
					title: params.title as string | undefined,
					text: params.text as string,
					namespace: params.namespace as string | undefined,
					source: params.source as string | undefined,
					metadata: params.metadata as Record<string, MetadataValue> | undefined,
				},
				sessionKey: ctx.sessionKey,
				agentId: ctx.agentId,
				workspaceDir: ctx.workspaceDir,
			});
			return textResult(`Stored memory ${record.logicalId} in namespace ${record.namespace}.`, {
				id: record.logicalId,
				namespace: record.namespace,
				path: record.path,
				mutationId: record.mutationId,
			});
		},
	};
}

export function createDeleteTool(pluginConfig: unknown, ctx: OpenClawPluginToolContext): AnyAgentTool {
	return {
		name: "cloudflare_memory_delete",
		label: "Cloudflare Memory Delete",
		description: "Delete a Cloudflare-backed memory record by id.",
		parameters: Type.Object({
			id: Type.String({ description: "Logical memory record id." }),
			namespace: Type.Optional(Type.String({ description: "Optional namespace override." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate) {
			const service = await buildService(pluginConfig, ctx);
			const mutationId = await service.delete({
				id: params.id as string,
				namespace: params.namespace as string | undefined,
				sessionKey: ctx.sessionKey,
				agentId: ctx.agentId,
				workspaceDir: ctx.workspaceDir,
			});
			return textResult(`Deleted memory ${params.id as string}.`, { mutationId });
		},
	};
}

import { basename } from "node:path";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";

function normalizeNamespacePart(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-_]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

export function sanitizeNamespace(value: string): string {
	const normalized = normalizeNamespacePart(value);
	return normalized || "main";
}

export function resolveDefaultNamespace(params: { fixedNamespace?: string; sessionKey?: string; agentId?: string; workspaceDir?: string }): string {
	if (params.fixedNamespace) {
		return sanitizeNamespace(params.fixedNamespace);
	}
	const agentId = params.sessionKey ? resolveAgentIdFromSessionKey(params.sessionKey) : params.agentId;
	if (agentId) {
		return sanitizeNamespace(`agent-${agentId}`);
	}
	if (params.workspaceDir) {
		return sanitizeNamespace(`workspace-${basename(params.workspaceDir)}`);
	}
	return "main";
}

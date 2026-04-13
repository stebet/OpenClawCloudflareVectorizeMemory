import path from "node:path";
import { fileURLToPath } from "node:url";

const bootstrapPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "BOOTSTRAP.md");

export default async function handler(event) {
	if (event?.type !== "agent" || event?.action !== "bootstrap") {
		return;
	}

	const bootstrapFiles = event?.context?.bootstrapFiles;
	if (!Array.isArray(bootstrapFiles) || bootstrapFiles.includes(bootstrapPath)) {
		return;
	}

	bootstrapFiles.push(bootstrapPath);
}

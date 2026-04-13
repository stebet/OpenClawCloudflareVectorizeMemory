import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CompanionRecord } from "./types.js";

type CompanionStoreFile = {
	version: 1;
	records: Record<string, CompanionRecord>;
};

function buildStoreKey(namespace: string, id: string): string {
	return `${namespace}::${id}`;
}

async function readStore(path: string): Promise<CompanionStoreFile> {
	try {
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw) as CompanionStoreFile;
	} catch {
		return {
			version: 1,
			records: {},
		};
	}
}

export class CompanionStore {
	constructor(private readonly path: string) {}

	get filePath(): string {
		return this.path;
	}

	async upsert(record: CompanionRecord): Promise<void> {
		const state = await readStore(this.path);
		state.records[buildStoreKey(record.namespace, record.id)] = record;
		await mkdir(dirname(this.path), { recursive: true });
		await writeFile(this.path, JSON.stringify(state, null, 2), "utf8");
	}

	async get(namespace: string, id: string): Promise<CompanionRecord | null> {
		const state = await readStore(this.path);
		return state.records[buildStoreKey(namespace, id)] ?? null;
	}

	async delete(namespace: string, id: string): Promise<void> {
		const state = await readStore(this.path);
		delete state.records[buildStoreKey(namespace, id)];
		await mkdir(dirname(this.path), { recursive: true });
		await writeFile(this.path, JSON.stringify(state, null, 2), "utf8");
	}

	async clear(): Promise<void> {
		await rm(this.path, { force: true });
	}
}

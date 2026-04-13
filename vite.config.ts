import { builtinModules } from "node:module";
import { defineConfig } from "vitest/config";

const external = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`), /^openclaw(?:\/.*)?$/, /^@sinclair\/typebox$/, /^zod$/];

export default defineConfig({
	build: {
		target: "node22",
		sourcemap: true,
		lib: {
			entry: "src/index.ts",
			formats: ["es"],
			fileName: "index",
		},
		rollupOptions: {
			external,
		},
	},
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
	},
});

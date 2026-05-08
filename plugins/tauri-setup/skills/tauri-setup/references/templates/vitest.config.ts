import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["src/test/setup.ts"],
		passWithNoTests: true,
		exclude: ["e2e/**", "node_modules/**"],
	},
	resolve: {
		alias: {
			// Why: sync point for the @/ alias (tsconfig, vite, vitest, components.json).
			"@": path.resolve(__dirname, "./src"),
		},
	},
});

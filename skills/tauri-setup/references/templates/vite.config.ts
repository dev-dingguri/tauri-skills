import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite"; // Remove this line if Tailwind is not chosen.
import path from "path";

// Multi-page input — only if multi-window.
// Single-window: delete `multiPageInput` and the `build.rollupOptions` block below.
const multiPageInput = {
	main: "index.html",
	// Add per window: overlay: "pages/overlay.html", etc.
};

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(), // Remove if Tailwind not chosen.
	],
	resolve: {
		alias: {
			// Why: sync point for the @/ alias (tsconfig, vite, vitest, components.json).
			"@": path.resolve(__dirname, "./src"),
		},
	},
	build: {
		rollupOptions: {
			input: multiPageInput,
		},
	},
	// Why env vars: multi-instance port allocation. The dev launcher script
	// (scripts/tauri-dev.mjs) owns the TAURI_DEV_PORT / TAURI_DEV_HOST contract —
	// see the tauri-multi-instance skill for details.
	server: {
		port: parseInt(process.env.TAURI_DEV_PORT || "1420"),
		strictPort: true,
		hmr: process.env.TAURI_DEV_HOST
			? {
					protocol: "ws",
					host: process.env.TAURI_DEV_HOST,
					port: parseInt(process.env.TAURI_DEV_PORT || "1420") + 1,
				}
			: undefined,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
});

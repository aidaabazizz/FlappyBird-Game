import pluginChecker from "vite-plugin-checker";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [pluginChecker({ typescript: true, overlay: false })],
});

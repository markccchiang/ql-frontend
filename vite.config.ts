import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath, URL} from "node:url";

// The backend binds loopback and speaks binary WebSocket with no auth
// (DESIGN §9), so the browser reaches it directly; VITE_WS_URL overrides.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {"@": fileURLToPath(new URL("./src", import.meta.url))}
    },
    server: {port: 5173, strictPort: true}
});

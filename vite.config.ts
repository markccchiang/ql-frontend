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
    server: {port: 5173, strictPort: true},
    build: {
        rollupOptions: {
            output: {
                // Split by how often each part changes: the generated bindings
                // move when the schema does, the vendor code almost never, and
                // the app on every commit. One bundle would re-download all
                // three every time.
                manualChunks: {
                    redux: ["@reduxjs/toolkit", "react-redux"],
                    mantine: ["@mantine/core", "@mantine/hooks", "react", "react-dom"],
                    protobuf: ["@bufbuild/protobuf"]
                }
            }
        }
    }
});

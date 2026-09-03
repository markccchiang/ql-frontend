import {defineConfig, devices} from "@playwright/test";

/** End-to-end checks against the app as it actually renders.
 *
 *  These exist because the defects this project has actually shipped were not
 *  the kind a type system or a unit test can see: a control that dropped its
 *  first edit, a column that scrolled the whole window, a chart drawn as 1970
 *  timestamps, a picker that never fired. Every one was found by opening the
 *  app and every one was found by hand, which meant none of them was guarded
 *  afterwards. This is that pass, written down.
 */
export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    workers: 1,
    reporter: process.env.CI ? "line" : [["list"]],
    timeout: 60_000,
    use: {
        baseURL: "http://localhost:5173",
        trace: "retain-on-failure",
        screenshot: "only-on-failure"
    },
    projects: [{name: "chromium", use: {...devices["Desktop Chrome"]}}],
    webServer: {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60_000
    }
});

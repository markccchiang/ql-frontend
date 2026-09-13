import {expect, expectNoWindowScroll, isBackendUp, test} from "./fixtures";

let hasBackend = false;

test.beforeAll(async () => {
    hasBackend = await isBackendUp();
    if (!hasBackend) {
        console.warn("[e2e] no ql-backend on 9111; the session checks are skipped, not passed");
    }
});

test.beforeEach(async ({page}) => {
    // Each check starts from the seed rather than whatever the last run left
    // in local storage.
    await page.addInitScript(() => {
        if (!sessionStorage.getItem("e2e-cleared")) {
            localStorage.clear();
            sessionStorage.setItem("e2e-cleared", "1");
        }
    });
    await page.goto("/");
    await expect(page.getByText("ql-backend", {exact: true})).toBeVisible();
});

test("loads and shows the market it will open with", async ({page}) => {
    await expect(page.getByText("ws://127.0.0.1:9111")).toBeVisible();
    for (const id of ["S", "R", "Q", "V", "RC", "QC", "VOL"]) {
        await expect(page.getByText(id, {exact: true}).first()).toBeVisible();
    }
    await expectNoWindowScroll(page);
});

test("the guide is one click away, in a tab of its own", async ({page}) => {
    // A reference the reader keeps open beside the workbench. It opens in a
    // new tab on purpose: this app's sessions die with the socket, and
    // navigating away to read the maths would take the graph with it.
    const guide = page.getByRole("link", {name: "guide"});
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute("target", "_blank");
    await expect(guide).toHaveAttribute("href", /index\.html$/);
    await expectNoWindowScroll(page);
});

test("the frame never scrolls, however tall the trade gets", async ({page}) => {
    // The swap is the tallest thing this app builds; the centre column has to
    // absorb it rather than the window.
    await page.getByRole("button", {name: "load swap example"}).click();
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();
    await expectNoWindowScroll(page);
});

test("prices the HANDLERS.md reference", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");

    await page.getByRole("button", {name: "run reference check"}).click();
    await expect(page.getByText("12.459717").first()).toBeVisible({timeout: 20_000});
    await expect(page.getByText("matches HANDLERS.md").first()).toBeVisible();
    await expectNoWindowScroll(page);
});

test("an answered required field stops saying it is required", async ({page}) => {
    // The exact defect that shipped past a green test suite: the engine
    // parameter setters only wrote into a block that already existed, so the
    // first choice of an American approximation was dropped and the control
    // went on claiming to be unanswered.
    // Mantine labels both the input and its listbox, so the input is asked
    // for by role rather than by label alone.
    await page.getByRole("textbox", {name: "type", exact: true}).first().click();
    await page.getByRole("option", {name: "American"}).click();

    const approximation = page.getByRole("textbox", {name: "approximation"});
    await expect(approximation).toHaveValue("");
    await expect(page.getByText("An American analytic price needs an explicit approximation", {exact: false})).toBeVisible();

    await approximation.click();
    await page.getByRole("option", {name: "Barone-Adesi / Whaley"}).click();

    await expect(approximation).toHaveValue("Barone-Adesi / Whaley");
    await expect(page.getByText("An American analytic price needs an explicit approximation", {exact: false})).toHaveCount(0);
});

test("closed engines say why they are closed", async ({page}) => {
    await page.getByRole("textbox", {name: "type", exact: true}).first().click();
    await page.getByRole("option", {name: "American"}).click();

    await page.getByRole("textbox", {name: "method"}).click();
    // Disabled, and carrying the backend's own reason rather than nothing.
    await expect(page.getByRole("option", {name: /integral/}).first()).toContainText("European only");
    await expect(page.getByRole("option", {name: /Monte Carlo/}).first()).toContainText("European only");
});

test("an implied volatility asks for the price to invert, and takes the last one", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");

    // Price first, so there is a last price for the button to offer.
    await page.getByRole("button", {name: "run reference check"}).click();
    await expect(page.getByText("12.459717").first()).toBeVisible({timeout: 20_000});

    // Mantine's pill wrapper sits over its own input and takes the pointer
    // event, so the click is aimed at the input the label names.
    await page.getByRole("textbox", {name: "results"}).click({force: true});
    await page.getByRole("option", {name: "implied volatility", exact: true}).click();
    await page.keyboard.press("Escape");

    // The card appears only once the kind is asked for, and complains until it
    // has a price: the request would otherwise be refused on the wire.
    const target = page.getByRole("textbox", {name: "target price"});
    await expect(target).toBeVisible();
    await expect(page.getByText("A price to invert is required, and it has to be positive.")).toBeVisible();

    await page.getByRole("button", {name: "from last price"}).click();
    await expect(target).toHaveValue(/12\.4597/);
    await expect(page.getByText("A price to invert is required, and it has to be positive.")).toHaveCount(0);

    await expectNoWindowScroll(page);
});

test("a socket that will not open says whether anything is there", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");

    // A failed WebSocket handshake tells script nothing — no status, no reason.
    // Since the gateway started checking Origin, "not running" and "running and
    // refusing this page" are both plausible and look identical, so the app
    // asks /healthz over plain HTTP to tell them apart.
    await page.routeWebSocket(/9111/, ws => ws.close());
    await page.reload();

    await expect(page.getByText("running, but refusing this page")).toBeVisible({timeout: 20_000});
    await expectNoWindowScroll(page);
});

// The browser logs its own complaint about a request this test told it to
// block. That is the block working, not the app failing.
test.describe("with the health probe blocked", () => {
    test.use({allowedConsoleErrors: [/Failed to load resource/]});

    test("and says so plainly when nothing is there at all", async ({page}) => {
        // Both the socket and the health probe blocked: the address answers
        // nothing, which is a different problem with a different fix.
        await page.routeWebSocket(/9111/, ws => ws.close());
        await page.route("**/healthz", route => route.abort());
        await page.reload();

        await expect(page.getByText("nothing answering")).toBeVisible({timeout: 20_000});
        await expectNoWindowScroll(page);
    });
});

import type {Page, WebSocketRoute} from "@playwright/test";

import {expect, expectNoWindowScroll, isBackendUp, test} from "./fixtures";

/** Session tabs: several workbooks, several sessions, one socket. */
let hasBackend = false;

test.beforeAll(async () => {
    hasBackend = await isBackendUp();
});

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        if (!sessionStorage.getItem("e2e-cleared")) {
            localStorage.clear();
            sessionStorage.setItem("e2e-cleared", "1");
        }
    });
    await page.goto("/");
    await expect(page.getByText("ql-backend", {exact: true})).toBeVisible();
});

async function openSession(page: Page) {
    await page.getByRole("button", {name: "Open Session", exact: true}).click();
    await expect(page.getByText(/bootstrap .* ms/)).toBeVisible({timeout: 20_000});
}

test("every tab survives a reload, not only the one in front", async ({page}) => {
    // Only the workbook in front was saved, under one key, so a reload kept
    // whichever tab happened to be showing and lost the rest.
    await page.getByRole("button", {name: "Load Swap Example"}).click();
    await page.getByRole("textbox", {name: "workbook label"}).fill("the swap");
    await page.getByRole("button", {name: "new tab"}).click();
    await page.getByRole("textbox", {name: "workbook label"}).fill("the option");
    await expect(page.getByRole("tab")).toHaveCount(2);

    await page.reload();

    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("tab").first()).toHaveText(/the swap/i);
    await expect(page.getByRole("tab").nth(1)).toHaveText(/the option/i);
    // The one in front is still the one in front, and the other kept its document.
    await expect(page.getByRole("textbox", {name: "workbook label"})).toHaveValue("the option");
    await page.getByRole("tab").first().click();
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();
});

test("a new tab starts from the seed and does not disturb the first", async ({page}) => {
    await page.getByRole("button", {name: "Load Swap Example"}).click();
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();

    await page.getByRole("button", {name: "new tab"}).click();

    // The second tab is a fresh workbook, not a copy of the first.
    await expect(page.getByText("IDX", {exact: true})).toHaveCount(0);
    await expect(page.getByText("VOL", {exact: true}).first()).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expectNoWindowScroll(page);

    // And the first still holds the swap when you go back to it.
    await page.getByRole("tab").first().click();
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();
});

test("a tab keeps its own name when another is opened or switched to", async ({page}) => {
    // Every workbook action relabels the active tab, so that a renamed
    // document renames its tab. Opening and switching both swapped the
    // workbook in *before* moving the active tab, which wrote the arriving
    // document's name onto the tab being left: two tabs called "Workbook 2",
    // and no way back to the first one's name.
    await page.getByRole("tab").first().click();
    const name = page.getByRole("textbox", {name: "workbook label"});
    await name.fill("first document");
    await expect(page.getByRole("tab").first()).toHaveText(/first document/i);

    await page.getByRole("button", {name: "new tab"}).click();
    await expect(page.getByRole("tab").first()).toHaveText(/first document/i);
    await expect(page.getByRole("tab").nth(1)).toHaveText(/workbook 2/i);

    await page.getByRole("tab").first().click();
    await expect(page.getByRole("tab").first()).toHaveText(/first document/i);
    await expect(page.getByRole("tab").nth(1)).toHaveText(/workbook 2/i);
    await expectNoWindowScroll(page);
});

test("each tab keeps its own session, both open on one socket", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");

    await openSession(page);
    const first = await page
        .getByText(/^s-\d+$/)
        .first()
        .textContent();

    await page.getByRole("button", {name: "new tab"}).click();
    await expect(page.getByText("no session")).toBeVisible();
    await openSession(page);
    const second = await page
        .getByText(/^s-\d+$/)
        .first()
        .textContent();

    expect(second).not.toBe(first);

    // Going back finds the first session still live rather than reopened.
    await page.getByRole("tab").first().click();
    await expect(page.getByText(first!, {exact: true}).first()).toBeVisible();
    await expect(page.getByText("live", {exact: true})).toBeVisible();
});

test("a price in one tab does not land in the other", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");

    // The first tab prices the reference.
    await page.getByRole("button", {name: "Run Reference Check"}).click();
    await expect(page.getByText("12.459717").first()).toBeVisible({timeout: 20_000});

    // The second has its own, empty, result pane.
    await page.getByRole("button", {name: "new tab"}).click();
    await expect(page.getByText("No price yet.")).toBeVisible();

    await page.getByRole("tab").first().click();
    await expect(page.getByText("12.459717").first()).toBeVisible();
});

test("closing a tab returns to the one beside it", async ({page}) => {
    const first = page.getByRole("tab").first();
    const firstLabel = (await first.textContent())?.trim() ?? "";
    await page.getByRole("button", {name: "new tab"}).click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");

    await page
        .getByRole("button", {name: /^close /})
        .last()
        .click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    // Returned to, not merely left over: the one beside it is in front, with
    // its own document.
    await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab").first()).toContainText(firstLabel.replace(/\s*×$/, ""));
    // The last tab cannot be closed: there is always somewhere to be.
    await expect(page.getByRole("button", {name: /^close /})).toHaveCount(0);
    await expectNoWindowScroll(page);
});

test("a dropped socket is taken back, for the tab in front and the one behind", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");

    // The socket is intercepted and passed straight through to the service, so
    // the app talks to the real backend and the test holds the one thread it
    // needs to cut. No test-only seam in the client.
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/9111/, ws => {
        ws.connectToServer();
        sockets.push(ws);
    });
    await page.reload();
    await expect(page.getByText("ql-backend", {exact: true})).toBeVisible();

    // Two tabs, two sessions, one socket.
    await openSession(page);
    const parked = await page
        .getByText(/^s-\d+$/)
        .first()
        .textContent();
    await page.getByRole("button", {name: "new tab"}).click();
    await openSession(page);
    const visible = await page
        .getByText(/^s-\d+$/)
        .first()
        .textContent();

    // Cut. The service holds every session on that socket, with whatever was
    // running in them, for its grace window (DESIGN §9.4), and the client
    // reconnects on its own. The "held" badge is not asserted: reconnect and
    // resume take a few hundred milliseconds together, so it is gone before a
    // poll can reliably see it, and the thing worth checking is the outcome.
    for (const ws of sockets) ws.close();

    // The visible tab takes its session back: the same id, and no second
    // bootstrap, because nothing was rebuilt.
    await expect(page.getByText("resumed")).toBeVisible({timeout: 20_000});
    await expect(page.getByText(visible!, {exact: true}).first()).toBeVisible({timeout: 20_000});

    // And so does the one behind it, on the way in — a parked tab is the case
    // the window is most obviously for, since nobody was looking at it.
    await page.getByRole("tab").first().click();
    await expect(page.getByText("live", {exact: true})).toBeVisible({timeout: 20_000});
    await expect(page.getByText(parked!, {exact: true}).first()).toBeVisible({timeout: 20_000});

    // The graph is the one it had, so it still prices.
    await page.getByRole("button", {name: "Price", exact: true}).click();
    await expect(page.getByText("9.297476").first()).toBeVisible({timeout: 20_000});

    await expectNoWindowScroll(page);
});

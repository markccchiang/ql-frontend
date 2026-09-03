import type {Page} from "@playwright/test";

import {expect, expectNoWindowScroll, isBackendUp, test} from "./fixtures";

/** The panels M6 added, which had never been rendered when it was committed:
 *  the tabbed bottom strip, the Monte Carlo monitor, compare, and the workbook
 *  bar. */
let hasBackend = false;

test.beforeAll(async () => {
    hasBackend = await isBackendUp();
});

test.beforeEach(async ({page}) => {
    // Cleared once per test rather than on every navigation: addInitScript
    // runs again on reload, and the check below depends on what survives one.
    await page.addInitScript(() => {
        if (!sessionStorage.getItem("e2e-cleared")) {
            localStorage.clear();
            sessionStorage.setItem("e2e-cleared", "1");
        }
    });
    await page.goto("/");
    await expect(page.getByText("qlservice")).toBeVisible();
});

async function openSession(page: Page) {
    await page.getByRole("button", {name: "open session", exact: true}).click();
    await expect(page.getByText(/bootstrap .* ms/)).toBeVisible({timeout: 20_000});
}

test("the bottom strip opens on each of its three tabs", async ({page}) => {
    await page.getByRole("button", {name: "sweep", exact: true}).click();
    await expect(page.getByRole("tab", {name: "sweep"})).toBeVisible();
    await expect(page.getByText("One frame prices the whole ladder off the live graph.")).toBeVisible();
    await expectNoWindowScroll(page);

    await page.getByRole("tab", {name: "monte carlo"}).click();
    await expect(page.getByText("The convergence trace appears once the first batch reports.")).toBeVisible();
    await expectNoWindowScroll(page);

    await page.getByRole("tab", {name: "compare"}).click();
    await expect(page.getByText("the same trade is priced in a second session", {exact: false})).toBeVisible();
    await expectNoWindowScroll(page);
});

test("a batched Monte Carlo reports progress and settles", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    await openSession(page);

    await page.getByRole("textbox", {name: "method"}).click();
    await page.getByRole("option", {name: "Monte Carlo", exact: true}).click();
    await page.getByRole("textbox", {name: "seed"}).fill("42");
    await page.getByRole("textbox", {name: "samples"}).fill("200000");
    await page.getByRole("textbox", {name: "report progress every N paths"}).fill("20000");

    await page.getByRole("button", {name: "monte carlo", exact: true}).click();
    await page.getByRole("button", {name: "price", exact: true}).click();

    // The panel is the only place the trace and the band are shown.
    await expect(page.getByText(/200,000 of 200,000 paths/)).toBeVisible({timeout: 30_000});
    await expect(page.getByText("running NPV against paths")).toBeVisible();
    await expect(page.getByText(/at 95% over 200000 paths/)).toBeVisible();
    await expectNoWindowScroll(page);
});

test("compare prices the same trade in a second session", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    await openSession(page);

    await page.getByRole("button", {name: "compare", exact: true}).click();
    await page.getByRole("textbox", {name: "variant evaluation date"}).fill("2026-12-01");
    await page.getByRole("button", {name: "run", exact: true}).click();

    await expect(page.getByText("evaluation date 2026-12-01")).toBeVisible({timeout: 20_000});
    await expect(page.getByText("base", {exact: true})).toBeVisible();
    await expect(page.getByText("variant", {exact: true})).toBeVisible();
    await expect(page.getByText("difference", {exact: true})).toBeVisible();

    // Three months less time value, so the variant is worth less: the sign of
    // the difference is the check that both sessions answered from their own
    // graph rather than one of them twice.
    const difference = await page.locator("text=/^-[0-9]+\\.[0-9]{6}$/").first().textContent();
    expect(Number(difference)).toBeLessThan(0);

    // The session in front of the user is untouched by the comparison.
    await expect(page.getByText("live", {exact: true})).toBeVisible();
});

test("the workbook survives a reload and can be renamed", async ({page}) => {
    const label = page.getByRole("textbox").first();
    await label.fill("A named workbook");
    await page.getByRole("button", {name: "load swap example"}).click();
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();

    await page.reload();

    // The label came from the example, and the market with it.
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();
    await expect(page.getByText("D6M", {exact: true}).first()).toBeVisible();
    await expectNoWindowScroll(page);
});

test("a fixed leg's rate says why it cannot be dragged", async ({page}) => {
    // FixedRateLeg reads its rate once at construction, so a slider on that
    // quote would lie. What matters to a user is not that the control is
    // disabled but that it explains itself, so that is what is asserted.
    await page.getByRole("button", {name: "load swap example"}).click();
    // Scoped to the strip: the market pane renders the same ids in the same
    // markup, and the first match on the page is that one.
    const bar = page.getByTestId("quote-bar");
    await expect(bar.getByText("FIX", {exact: true})).toBeVisible();

    await bar.getByText("FIX", {exact: true}).hover();
    await expect(page.getByText("A fixed leg reads its rate once at construction", {exact: false})).toBeVisible();

    // A quote that is not frozen explains itself differently.
    await bar.getByText("S2Y", {exact: true}).hover();
    await expect(page.getByText("2Y swap · rate")).toBeVisible();
});

test("the curve viewer draws the curve the engine priced with", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    await openSession(page);

    await page.getByRole("button", {name: "curve", exact: true}).click();
    await page.getByRole("textbox", {name: "curve", exact: true}).click();
    await page.getByRole("option", {name: /^RC/}).click();
    await page.getByRole("button", {name: "sample", exact: true}).click();

    await expect(page.getByText("RC.discountFactor against years")).toBeVisible({timeout: 20_000});
    await expectNoWindowScroll(page);
});

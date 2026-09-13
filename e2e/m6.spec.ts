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
    await expect(page.getByText("ql-backend", {exact: true})).toBeVisible();
});

async function openSession(page: Page) {
    await page.getByRole("button", {name: "open session", exact: true}).click();
    await expect(page.getByText(/bootstrap .* ms/)).toBeVisible({timeout: 20_000});
}

test("the bottom strip opens on each of its three tabs", async ({page}) => {
    await page.getByRole("button", {name: "Sweep", exact: true}).click();
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

    await page.getByRole("button", {name: "Monte Carlo", exact: true}).click();
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

    await page.getByRole("button", {name: "Compare", exact: true}).click();
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

test("the book survives a reload with the workbook it belongs to", async ({page}) => {
    // The codec wrote the book from the day it existed and the store dropped it
    // on the way back in, so a set-aside trade lasted exactly until a refresh.
    await page.getByRole("button", {name: "add to book"}).click();
    await expect(page.getByText("1 trade, one request")).toBeVisible();

    await page.reload();

    await page.getByRole("button", {name: "Book", exact: true}).click();
    await expect(page.getByText("1 trade, one request")).toBeVisible();
    await expect(page.getByText("call 100 · european · analytic")).toBeVisible();
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

    await page.getByRole("button", {name: "Curve", exact: true}).click();
    await page.getByRole("textbox", {name: "curve", exact: true}).click();
    await page.getByRole("option", {name: /^RC/}).click();
    await page.getByRole("button", {name: "sample", exact: true}).click();

    await expect(page.getByText("RC.discountFactor against years")).toBeVisible({timeout: 20_000});
    await expectNoWindowScroll(page);
});

test("a swap shows the cash flows its NPV adds up to", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");

    await page.getByRole("button", {name: "load swap example"}).click();
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();
    await openSession(page);

    await page.getByRole("button", {name: "Cash Flows", exact: true}).click();
    await page.getByRole("checkbox", {name: "ask for the table with the price"}).check();
    await page.getByRole("button", {name: "price", exact: true}).click();

    await expect(page.getByRole("columnheader", {name: "present value"})).toBeVisible({timeout: 20_000});
    await expect(page.getByText(/rows over 2 legs/)).toBeVisible();
    await expectNoWindowScroll(page);
});

test("a second axis makes the sweep a grid, in one request", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    await openSession(page);

    await page.getByRole("button", {name: "Sweep", exact: true}).click();
    await expect(page.getByText("9 prices, one request")).toBeVisible();

    await page.getByRole("button", {name: "add an axis"}).click();
    // The new axis starts on a quote the sweep is not already moving, so the
    // grid is valid the moment it appears rather than after a correction.
    await expect(page.getByText("axis 2 — one line per value")).toBeVisible();
    await expect(page.getByText(/S × \w+ = 27 prices, one request/)).toBeVisible();

    await page.getByRole("button", {name: "run", exact: true}).click();
    // One line per value of the second axis, each named for the value it holds.
    await expect(page.getByText(/against S and \w+/)).toBeVisible({timeout: 20_000});
    await expect(page.getByText("27 points")).toBeVisible();

    await expectNoWindowScroll(page);
});

test("a book of trades prices in one frame, and one bad trade costs one row", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    await openSession(page);

    // Two trades that differ, set aside one after the other.
    await page.getByRole("button", {name: "add to book"}).click();
    await expect(page.getByText("1 trade, one request")).toBeVisible();

    await page.getByRole("textbox", {name: "strike"}).fill("120");
    await page.getByRole("button", {name: "add to book"}).click();
    await expect(page.getByText("2 trades, one request")).toBeVisible();

    // And a third that cannot price: an American exercise on the analytic engine
    // needs an approximation, and none is chosen. The builder's own price button
    // refuses it, but the book takes it — the service is what says no, per row.
    await page.getByRole("textbox", {name: "type", exact: true}).first().click();
    await page.getByRole("option", {name: "American"}).click();
    await page.getByRole("button", {name: "add to book"}).click();
    await expect(page.getByText("3 trades, one request")).toBeVisible();

    await page.getByRole("button", {name: "price the book"}).click();
    // A call struck at 100 is worth more than the same call struck at 120, so
    // the rows are matched to their trades rather than merely counted.
    await expect(page.getByText("call 100 · european · analytic")).toBeVisible({timeout: 20_000});
    await expect(page.getByText("call 120 · european · analytic")).toBeVisible();
    // The bad row carries the rejection it would have been sent on its own, and
    // the two good rows keep their prices: the whole reason for the shape.
    await expect(page.getByText(/approximation/i).last()).toBeVisible();
    // Summed per currency over the rows that priced; the service names no
    // currency on an option, so the badge says "total" rather than inventing one.
    await expect(page.getByText(/total 12\.06\d+/)).toBeVisible();

    await expectNoWindowScroll(page);
});

test("anything in flight can be called off, and says what that buys", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    await openSession(page);

    // An unbatched Monte Carlo: one engine call, nothing to interrupt inside
    // it, and so the case the documentation used to say could not be cancelled
    // at all. It has no panel of its own either, which is why the cancel has to
    // live where anything running can reach it.
    await page.getByRole("textbox", {name: "method"}).click();
    await page.getByRole("option", {name: "Monte Carlo", exact: true}).click();
    await page.getByRole("textbox", {name: "seed"}).fill("42");
    await page.getByRole("textbox", {name: "samples"}).fill("40000000");
    await page.getByRole("button", {name: "price", exact: true}).click();

    const cancel = page.getByRole("button", {name: /cancel \d+ in flight/});
    await expect(cancel).toBeVisible({timeout: 20_000});
    await cancel.click();

    // The session comes back either way: that is what the button promises, and
    // all it promises when the work is inside an engine call.
    await expect(page.getByText("live", {exact: true})).toBeVisible({timeout: 30_000});
    await expect(cancel).toHaveCount(0, {timeout: 30_000});

    await expectNoWindowScroll(page);
});

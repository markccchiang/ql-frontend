import {expect, test} from "./fixtures";

/** The engine card with a finite-difference engine and no grid.
 *
 *  A workbook can arrive that way -- imported, or restored from storage --
 *  and the card then shows the "choose a grid" error on engine.fd. Choosing a
 *  grid clears it, and EngineCard used to read that error with a hook called
 *  only when the first one found nothing: the card rendered a different
 *  number of hooks, React threw, and with no error boundary the whole app
 *  went blank. The fixture fails the test on the page error.
 */
// No session is needed, so none is required: without a backend the browser
// logs its failed connection attempts, which is not this card misbehaving.
test.use({allowedConsoleErrors: [/ERR_CONNECTION_REFUSED/]});

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

test("choosing a grid for a finite-difference engine that had none keeps the app up", async ({page}) => {
    // Finite difference through the UI, which always sets a preset grid...
    await page.getByRole("textbox", {name: "method", exact: true}).click();
    await page.getByRole("option", {name: /finite difference/}).click();

    // ...then the grid taken out of the stored workbook, as an import or an
    // older build could leave it, and the page reloaded onto that. Written by
    // an init script rather than straight into storage: the page saves its
    // own workbook on the way out, which would put the grid back.
    const key = "ql-frontend.tabs.v1";
    await expect.poll(() => page.evaluate(k => localStorage.getItem(k)?.includes('"fd"') ?? false, key)).toBe(true);
    const saved = JSON.parse((await page.evaluate(k => localStorage.getItem(k), key))!);
    const engine = saved.tabs[0].workbook.trade.engine;
    delete engine.fd.preset;
    delete engine.fd.custom;
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(saved)] as const);
    await page.reload();

    // No grid at all: the one field the trade is missing, and no preset to pick.
    await expect(page.getByText("1 required field")).toBeVisible();
    await expect(page.getByRole("textbox", {name: "preset"})).toHaveCount(0);

    await page.getByText("explicit", {exact: true}).click();
    await expect(page.getByRole("textbox", {name: "time steps"})).toBeVisible();
});

test("the control variate is offered where an engine reads it, and shown where it is set", async ({page}) => {
    const method = page.getByRole("textbox", {name: "method", exact: true});
    const style = page.getByRole("textbox", {name: "style", exact: true});
    const controlVariate = page.getByRole("checkbox", {name: "control variate"});

    await method.click();
    await page.getByRole("option", {name: /monte carlo/i}).click();
    // A vanilla Monte Carlo has no control variate to offer.
    await expect(page.getByRole("textbox", {name: "seed"})).toBeVisible();
    await expect(controlVariate).toHaveCount(0);

    await style.click();
    await page.getByRole("option", {name: "asian", exact: true}).click();
    await controlVariate.check();

    // Back to vanilla with it set: kept on screen, beside the reason it will
    // be refused, until it is cleared.
    await style.click();
    await page.getByRole("option", {name: "vanilla", exact: true}).click();
    await expect(controlVariate).toBeChecked();
    await expect(page.getByText("Only the Asian Monte Carlo has a control variate")).toBeVisible();
    // A click rather than uncheck(): cleared, it leaves the card, and
    // uncheck() waits to see it unchecked.
    await controlVariate.click();
    await expect(controlVariate).toHaveCount(0);
});

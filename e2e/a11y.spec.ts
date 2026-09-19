import AxeBuilder from "@axe-core/playwright";
import type {Page} from "@playwright/test";

import {expect, test} from "./fixtures";

/** An accessibility pass that is checked rather than asserted by eye.
 *
 *  Scoped to serious and critical violations of WCAG 2 A/AA: this is a dense
 *  internal tool, not a public site, and a rule about landmark regions is not
 *  worth a failing build. Contrast and names are.
 */
async function scan(page: Page) {
    return new AxeBuilder({page}).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
}

function serious(results: Awaited<ReturnType<typeof scan>>) {
    return results.violations
        .filter(violation => violation.impact === "serious" || violation.impact === "critical")
        .map(violation => `${violation.id} (${violation.impact}) on ${violation.nodes.length}: ${violation.nodes[0]?.target.join(" ")}`);
}

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

test("the option workbook has no serious accessibility violations", async ({page}) => {
    expect(serious(await scan(page))).toEqual([]);
});

test("the swap workbook has none either", async ({page}) => {
    await page.getByRole("button", {name: "Load Swap Example"}).click();
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();
    expect(serious(await scan(page))).toEqual([]);
});

test("the bottom panels have none", async ({page}) => {
    for (const tab of ["Sweep", "Monte Carlo", "Compare"]) {
        await page.getByRole("button", {name: tab, exact: true}).click();
        expect(serious(await scan(page)), `${tab} panel`).toEqual([]);
    }
});

test("every control can be reached and named", async ({page}) => {
    // Icon-only buttons are the ones that lose their names, and this app is
    // full of them: add, remove, pin, close.
    const unnamed = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
            // Mantine's own number spinners and clear buttons are internal
            // and axe does not surface them; this rule is about ours.
            .filter(button => !/NumberInput-control|InputClearButton|Pill-remove/.test(button.className))
            .filter(button => !(button.textContent?.trim() || button.getAttribute("aria-label") || button.getAttribute("title")))
            .map(button => button.outerHTML.slice(0, 120))
    );
    expect(unnamed).toEqual([]);
});

test("a glyph is not a name", async ({page}) => {
    // The check above passes a button whose only text is "×" or "+": it has
    // text, and axe takes that as its name. A screen reader then says "times"
    // or "plus" for remove-this-leg and add-a-market-object. The swap example
    // shows every such button at once: market rows, legs, pillars, the pin.
    await page.getByRole("button", {name: "Load Swap Example"}).click();
    await expect(page.getByText("IDX", {exact: true}).first()).toBeVisible();
    await page.getByText("BC", {exact: true}).first().click();
    const glyphs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
            .filter(button => !button.getAttribute("aria-label") && /^[+×⚲]$/.test(button.textContent?.trim() ?? ""))
            .map(button => button.outerHTML.slice(0, 120))
    );
    expect(glyphs).toEqual([]);
});

test("two tabs, and so a close button on each, have no serious violations", async ({page}) => {
    // One tab shows no close button, so the scans above never saw one -- and
    // it sat inside the element with role="tab", a control inside a control.
    await page.getByRole("button", {name: "new tab"}).click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    expect(serious(await scan(page))).toEqual([]);
});

test("a market row and a correlation toggle work from the keyboard", async ({page}) => {
    // Both were click-only divs: nothing to tab to, nothing to press.
    await page.getByRole("button", {name: "add market object"}).click();
    await page.getByRole("menuitem", {name: "correlation matrix"}).click();
    const row = page.getByRole("button", {name: /^CORR\d* correlation/});
    // Added, it is selected; Enter puts it down, and Enter again picks it up.
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-pressed", "true");

    const toggle = page.getByRole("button", {name: /^(fix|live)$/}).first();
    const before = await toggle.textContent();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", {name: /^(fix|live)$/}).first()).not.toHaveText(before ?? "");
});

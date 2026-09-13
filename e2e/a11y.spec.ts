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

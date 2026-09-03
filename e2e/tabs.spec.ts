import type {Page} from "@playwright/test";
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
    await expect(page.getByText("qlservice")).toBeVisible();
});

async function openSession(page: Page) {
    await page.getByRole("button", {name: "open session", exact: true}).click();
    await expect(page.getByText(/bootstrap .* ms/)).toBeVisible({timeout: 20_000});
}

test("a new tab starts from the seed and does not disturb the first", async ({page}) => {
    await page.getByRole("button", {name: "load swap example"}).click();
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
    await page.getByRole("button", {name: "run reference check"}).click();
    await expect(page.getByText("12.459717").first()).toBeVisible({timeout: 20_000});

    // The second has its own, empty, result pane.
    await page.getByRole("button", {name: "new tab"}).click();
    await expect(page.getByText("No price yet.")).toBeVisible();

    await page.getByRole("tab").first().click();
    await expect(page.getByText("12.459717").first()).toBeVisible();
});

test("closing a tab returns to the one beside it", async ({page}) => {
    await page.getByRole("button", {name: "new tab"}).click();
    await expect(page.getByRole("tab")).toHaveCount(2);

    await page
        .getByRole("button", {name: /^close /})
        .last()
        .click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    // The last tab cannot be closed: there is always somewhere to be.
    await expect(page.getByRole("button", {name: /^close /})).toHaveCount(0);
    await expectNoWindowScroll(page);
});

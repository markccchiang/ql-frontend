import {fromBinary} from "@bufbuild/protobuf";
import type {Page} from "@playwright/test";

import {ClientFrameSchema} from "../src/gen/quantlib/v2/envelope_pb";

import {expect, isBackendUp, test} from "./fixtures";

/** Quote entry: the one edit that reaches a live graph without a rebuild.
 *
 *  Each check here reads the frames the app actually sends, because what the
 *  screen shows is the workbook, and the defects were all in the gap between
 *  the two: a market editor that changed the screen and never the graph, a
 *  cleared box that sent a spot of zero, a slider whose range moved with the
 *  thumb.
 */
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
});

/** Every UpdateMarket quote write the page sends, in order. */
async function recordQuoteWrites(page: Page): Promise<{quoteId: string; value: number}[]> {
    const writes: {quoteId: string; value: number}[] = [];
    await page.routeWebSocket(/9111/, ws => {
        const server = ws.connectToServer();
        ws.onMessage(message => {
            if (typeof message !== "string") {
                const frame = fromBinary(ClientFrameSchema, new Uint8Array(message));
                if (frame.payload.case === "updateMarket") {
                    for (const quote of frame.payload.value.quotes) writes.push({quoteId: quote.quoteId, value: quote.value});
                }
            }
            server.send(message);
        });
        server.onMessage(message => ws.send(message));
    });
    return writes;
}

async function openSession(page: Page) {
    await page.goto("/");
    await page.getByRole("button", {name: "Open Session", exact: true}).click();
    await expect(page.getByText(/bootstrap .* ms/)).toBeVisible({timeout: 20_000});
}

test("clearing a quote box to type a new value never sends zero", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    const writes = await recordQuoteWrites(page);
    await openSession(page);

    const box = page.getByTestId("quote-bar").getByRole("textbox", {name: "S value"});
    await box.fill("");
    await box.pressSequentially("110");
    await expect.poll(() => writes.filter(w => w.quoteId === "S").at(-1)?.value).toBe(110);

    const spots = writes.filter(w => w.quoteId === "S").map(w => w.value);
    expect(spots, "a cleared box is not a spot of zero").not.toContain(0);
});

test("a quote edited in the market editor reaches the live graph", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    const writes = await recordQuoteWrites(page);
    await openSession(page);

    // The market pane's row, not the quote bar's label of the same id.
    await page.getByText("S", {exact: true}).first().click();
    const value = page.getByRole("textbox", {name: "value", exact: true});
    await value.fill("");
    await value.pressSequentially("107.5");

    await expect.poll(() => writes.filter(w => w.quoteId === "S").at(-1)?.value).toBe(107.5);
    await expect(page.getByText("stale", {exact: false})).toHaveCount(0);
});

test("a slider's thumb stays where it is let go", async ({page}) => {
    test.skip(!hasBackend, "needs ql-backend on 9111");
    await recordQuoteWrites(page);
    await openSession(page);

    const bar = page.getByTestId("quote-bar");
    const thumb = bar.getByRole("slider", {name: "S slider"});
    const track = thumb.locator("xpath=..");
    const box = (await track.boundingBox())!;
    const start = (await thumb.boundingBox())!;

    // From the thumb to four fifths of the track, in steps a hand would take.
    const y = start.y + start.height / 2;
    const target = box.x + box.width * 0.8;
    await page.mouse.move(start.x + start.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(target, y, {steps: 12});
    const during = (await thumb.boundingBox())!;
    await page.mouse.up();
    const after = (await thumb.boundingBox())!;

    const at = (b: {x: number; width: number}) => (b.x + b.width / 2 - box.x) / box.width;
    expect(at(during), "the thumb follows the pointer while dragged").toBeGreaterThan(0.7);
    expect(at(after), "and stays where it was let go").toBeGreaterThan(0.7);
});

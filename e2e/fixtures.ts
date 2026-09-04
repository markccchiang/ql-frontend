import type {Page} from "@playwright/test";
import {expect, test as base} from "@playwright/test";

/** Whether ql-backend is listening.
 *
 *  Probed once per run. Tests that need it are skipped rather than passed:
 *  a check that quietly returns when its dependency is missing reports green
 *  and is indistinguishable from one that verified something.
 */
export async function isBackendUp(): Promise<boolean> {
    const url = process.env.QL_BACKEND ?? "ws://127.0.0.1:9111";
    return new Promise(resolve => {
        try {
            const socket = new WebSocket(url);
            const timer = setTimeout(() => {
                socket.close();
                resolve(false);
            }, 2000);
            socket.onopen = () => {
                clearTimeout(timer);
                socket.close();
                resolve(true);
            };
            socket.onerror = () => {
                clearTimeout(timer);
                resolve(false);
            };
        } catch {
            resolve(false);
        }
    });
}

/** Fails the test on any console error or uncaught exception.
 *
 *  Two of this project's bugs announced themselves only here — unmemoised
 *  selectors that re-rendered a panel on every unrelated action.
 */
export const test = base.extend<{page: Page; allowedConsoleErrors: RegExp[]}>({
    /** Console errors a test causes on purpose.
     *
     *  Empty by default, and it stays that way for every test that is not
     *  deliberately breaking something: a test that blocks a request gets the
     *  browser's own complaint about the block, which is not the app
     *  misbehaving. Declaring the pattern keeps the check strict everywhere
     *  else rather than loosening it for all of them.
     */
    allowedConsoleErrors: [[], {option: true}],

    page: async ({page, allowedConsoleErrors}, use) => {
        const problems: string[] = [];
        page.on("console", message => {
            if (message.type() === "error" && !allowedConsoleErrors.some(pattern => pattern.test(message.text()))) {
                problems.push(`console.error: ${message.text()}`);
            }
            // React and Redux report these as warnings, and they are defects.
            if (message.type() === "warning" && /Selector .* returned a different result/.test(message.text())) {
                problems.push(`unmemoised selector: ${message.text().split("\n")[0]}`);
            }
        });
        page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));

        await use(page);

        expect(problems, "the page reported no errors").toEqual([]);
    }
});

/** The window itself must never scroll.
 *
 *  The panes scroll; the frame does not. When this broke, every control moved
 *  out from under the pointer mid-interaction.
 */
export async function expectNoWindowScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => ({
        vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    expect(overflow.vertical, "the window scrolls vertically").toBeLessThanOrEqual(1);
    expect(overflow.horizontal, "the window scrolls horizontally").toBeLessThanOrEqual(1);
}

export {expect};

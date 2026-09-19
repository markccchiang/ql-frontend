import {expect, test} from "./fixtures";

/** Fields that hold a list, typed a character at a time, as a user types them.
 *
 *  Each was controlled by the list it parsed to, so every keystroke was parsed
 *  and the list written back over the text: "0." became "0", a comma or a new
 *  line vanished before the next character could follow it, and only pasting
 *  got a decimal or a second line in.
 */
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

test("sweep factors take a decimal and a comma as they are typed", async ({page}) => {
    await page.getByRole("button", {name: "Sweep", exact: true}).click();
    await page.getByText("relative", {exact: true}).first().click();
    const factors = page.getByRole("textbox", {name: "factors"});
    await factors.fill("");
    await factors.pressSequentially("0.85, 1.15");
    await expect(factors).toHaveValue("0.85, 1.15");
});

test("Bermudan exercise dates take a new line", async ({page}) => {
    await page.getByRole("textbox", {name: "type", exact: true}).first().click();
    await page.getByRole("option", {name: "Bermudan"}).click();
    const dates = page.getByRole("textbox", {name: "exercise dates"});
    await dates.fill("");
    await dates.pressSequentially("2027-03-01\n2027-09-01");
    await expect(dates).toHaveValue("2027-03-01\n2027-09-01");
});

test("a leg's notionals keep a trailing comma rather than a zero after it", async ({page}) => {
    await page.getByRole("button", {name: "Load Swap Example"}).click();
    const notionals = page.getByRole("textbox", {name: "notionals"}).first();
    await notionals.fill("");
    await notionals.pressSequentially("1000000, ");
    await expect(notionals).toHaveValue("1000000, ");
});

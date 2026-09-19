# Testing

How to run the checks, and what each of them is actually guarding.

`PLAN.md` §10 sets out the strategy; this page is the operational version of
it, derived from the suites as they stand rather than from the plan.

## The three layers

| Layer | Command | What it is for |
| --- | --- | --- |
| Unit | `npm test` | Pure logic: the dependency sort, the validation rules, the capability matrix, the workbook codec |
| Integration | `npm test` | The protocol against a running `ql-backend`: exact numbers, progress frames, cancellation, two sessions on one socket |
| End to end | `npm run e2e` | The app as it renders: wiring, layout, and the text a user reads |

The split is not arbitrary. Numbers and protocol semantics belong in the
integration tests, which give exact figures and re-run cheaply; a progress bar
watched in a browser tells you nothing you can assert on. Rendering, layout and
wiring belong in Playwright, because no type system reaches them. The
end-to-end suite deliberately does not check prices beyond the one reference
value — that is not its job.

## Running the end-to-end suite

```bash
npx playwright install chromium        # once, ~95 MB
./build/ql-backend --port 9111 &       # from the ql-backend checkout
npm run e2e
```

The dev server starts itself. `playwright.config.ts` declares a `webServer`
with `reuseExistingServer: true`, so it attaches to a `npm run dev` you already
have and otherwise starts one.

**The backend does not start itself.** Thirteen of the thirty checks need it and are
**skipped** without it — reported as skipped, never as passed. A check that
quietly returns when its dependency is missing reports green and is
indistinguishable from one that verified something.

| Command | |
| --- | --- |
| `npm run e2e` | Everything, headless |
| `npm run e2e:ui` | The Playwright UI: pick tests, watch them, step through |
| `npx playwright test --headed` | Watch a real browser |
| `npx playwright test --grep "monte carlo"` | One test or a group |
| `npx playwright test --debug` | Step through with the inspector |
| `npx playwright show-trace test-results/<dir>/trace.zip` | Post-mortem of a failure |

Failures keep a screenshot and a trace under `test-results/`; passes keep
nothing. The suite runs single-file (`workers: 1`) because the checks share one
backend and one browser profile.

## What the end-to-end suite covers

Forty-four checks in seven files under `e2e/`, all listed below. Each one exists because of a defect this project
actually shipped, or a claim nothing else can verify.

### `e2e/app.spec.ts` — the app, and the option path

| Check | What it guards |
| --- | --- |
| **loads and shows the market it will open with** | The app boots, reaches the socket, and lists the seven seed objects. The smoke test everything else depends on |
| **the frame never scrolls, however tall the trade gets** | Loads the swap — the tallest thing this app builds — and asserts the window still does not scroll. When this broke, every control moved out from under the pointer mid-interaction |
| **prices the HANDLERS.md reference** *(needs the backend)* | Open, bump, price, and `12.459717` on screen with its badge. The number the backend's own documentation records |
| **an answered required field stops saying it is required** | Switch to American, see the approximation demanded, answer it, and watch the demand go away. This is the exact defect that shipped past a green unit suite: the engine parameter setters wrote only into a block that already existed, so the first choice was dropped and the control went on claiming to be unanswered |
| **closed engines say why they are closed** | On an American exercise the integral and Monte Carlo options are disabled *and* carry the backend's own reason. Gating without a reason is a dead end for the user |
| **a socket that will not open says whether anything is there** *(needs the backend)* | A failed WebSocket handshake reports nothing to script, so "not running" and "running and refusing this page" looked identical — and since the gateway started checking `Origin`, the second is a real way to be stuck. The app probes `/healthz` and says which |
| **and says so plainly when nothing is there at all** | The other branch, with the health probe blocked too. Declares the browser's own complaint about the blocked request through `allowedConsoleErrors`, which is empty for every other test |
| **an implied volatility asks for the price to invert, and takes the last one** *(needs the backend)* | Ticking the kind raises its card, the card refuses to be empty, and "from last price" fills in the NPV that just came back. The result is the only one computed from something the request carries, and the round trip is the question it exists for |

### `e2e/m6.spec.ts` — the long-running panels and the document

| Check | What it guards |
| --- | --- |
| **the bottom strip opens on each of its three tabs** | Sweep, Monte Carlo and Compare each render, and none of them makes the window scroll |
| **a batched Monte Carlo reports progress and settles** *(needs the backend)* | 200,000 paths in batches of 20,000: the progress reaches `200,000 of 200,000`, the convergence trace appears, and the 95% band is shown. The whole point of batching |
| **compare prices the same trade in a second session** *(needs the backend)* | A variant evaluation date prices in its own session; base, variant and a negative difference all render, and the primary session is still live afterwards. The one capability the gateway advertises that nothing else here uses |
| **the book survives a reload with the workbook it belongs to** | The codec wrote the book from the day it existed and the store dropped it on the way back in, so a set-aside trade lasted exactly until a refresh |
| **the workbook survives a reload** | Load the swap example, reload, and the index and pillar quotes are still there. Persistence end to end, through the codec and local storage |
| **a fixed leg's rate says why it cannot be dragged** | `FixedRateLeg` reads its rate once at construction, so a slider on that quote would lie. The check is that it *explains itself*, not merely that it is disabled |
| **the curve viewer draws the curve the engine priced with** *(needs the backend)* | `curve_samples` comes back off the same term structures the price was made on, and the panel checks itself: every discount factor agrees with its own zero rate. A curve rebuilt in the browser would not be evidence of anything |
| **a swap shows the cash flows its NPV adds up to** *(needs the backend)* | The present-value column sums to the NPV, because each row's discount is the one the engine used. The table is working, not decoration |
| **anything in flight can be called off, and says what that buys** *(needs the backend)* | An unbatched Monte Carlo is one engine call with nothing to interrupt inside it, and no panel of its own — the case that had no cancel at all while the documentation said it could not be cancelled. The status bar offers one for whatever is running, and the session comes back |
| **a book of trades prices in one frame, and one bad trade costs one row** *(needs the backend)* | Two trades set aside and a third that cannot price — an American exercise with neither its `payoff_at_expiry` Flag nor an approximation. All three go in the book, the two good ones come back with prices and a total, and the bad one carries the service's own complaint, looked for on that row: it used to look for "approximation" anywhere on the page, which the engine card's own control always matched, and the service in fact names the Flag first. The builder's price button would have refused it; the book lets the service be the one to say no, per row |
| **a second axis makes the sweep a grid, in one request** *(needs the backend)* | Adding an axis says `S × V = 27 prices, one request` before the run and draws a line per value of the second axis after it. It caught two defects on its first run: the panel's own run button dispatched the top strip's *toggle* and so closed the panel it was about to draw into, and uPlot's legend was being cut off because it is not counted in the height the canvas is given |

### `e2e/tabs.spec.ts` — several workbooks, several sessions

| Check | What it guards |
| --- | --- |
| **every tab survives a reload, not only the one in front** | Only the workbook in front was saved, so a reload kept one tab and lost the rest |
| **a tab keeps its own name when another is opened or switched to** | Opening or switching swapped the document in before moving the active tab, which wrote the arriving document's name onto the tab being left |
| **a new tab starts from the seed and does not disturb the first** | The second tab is a fresh workbook rather than a copy, and going back finds the first as it was left |
| **each tab keeps its own session, both open on one socket** *(needs the backend)* | Two session ids, and the first still live when you return to it rather than reopened |
| **a price in one tab does not land in the other** *(needs the backend)* | The middleware mirrors every frame into the store, so this is the check that a reply is matched to the session that asked |
| **closing a tab returns to the one beside it** | The one beside it is in front, with its own label — the check used to count tabs and nothing more. And the last tab cannot be closed: there is always somewhere to be |
| **a tab closes from the keyboard** | Delete on a focused tab closes it, as the WAI-ARIA tabs pattern has it; the × beside it is the mouse's way and is kept out of the accessibility tree |
| **a dropped socket is taken back, for the tab in front and the one behind** *(needs the backend)* | Playwright routes the WebSocket straight through to the running service and then cuts it — a real drop, with no test-only seam in the client. Both tabs must come back with the *same* session ids they had, because the service holds a dropped session and the work in it for a grace window (DESIGN §9.4), and the parked one must do it on the way in. It priced the replay path before resume existed; it prices the resume path now, and the replay fallback is covered by restarting the service |

### `e2e/a11y.spec.ts` — the accessibility pass

Axe against WCAG 2 A/AA, on the option workbook, the swap workbook and each of
the three bottom panels, plus a check that no button of ours is unnamed.
Scoped to **serious and critical** violations: this is a dense internal tool,
and a rule about landmark regions is not worth a failing build, but contrast
and names are.

It found three real defects on its first run. Mantine's dimmed grey missed
4.5:1 — and dimmed is what nearly every explanation in this app is written in,
so the sentence saying why an engine is closed could not be read. White on the
primary teal was 3.94:1 at button size. And five inputs whose label was a
neighbouring word rather than a label.

Four more checks came later, each for a defect the scans above could not see:
**a glyph is not a name** (axe accepts "×" and "+" as a button's name, which a
screen reader reads as "times" and "plus"), **two tabs, and so a close button
on each** (with one tab there is no close button to find inside the tab),
**a market row and a correlation toggle work from the keyboard** (both were
click-only), and **every control can be reached and named**.

### `e2e/engine.spec.ts` — the engine card, and the document on its way out

| Check | What it guards |
| --- | --- |
| **choosing a grid for a finite-difference engine that had none keeps the app up** | EngineCard read one error with a hook called only when another found nothing, so the hook count changed and the app went blank. The fixture fails any test on a page error |
| **the control variate is offered where an engine reads it, and shown where it is set** | Only the Asian Monte Carlo takes one. A vanilla shows no box; one left set after switching away stays on screen beside the reason it will be refused, until it is cleared |
| **Export writes the document on screen, as it is when the button is pressed** | The bar reads only the label now and the rest when Export is pressed; the file still carries the whole document, with the latest of everything in it |

### `e2e/quotes.spec.ts` — entering a quote

| Check | What it guards |
| --- | --- |
| **clearing a quote box to type a new value never sends zero** | An emptied box read as 0 and priced it. The frames on the socket are decoded and checked, not the screen |
| **a quote edited in the market editor reaches the live graph** | The editor wrote the workbook and nothing else, so the next price was off the old value |
| **a slider's thumb stays where it is let go** | The range was recentred on every value, so the thumb jumped back to the middle under the pointer |

### `e2e/typing.spec.ts` — lists typed a character at a time

| Check | What it guards |
| --- | --- |
| **sweep factors take a decimal and a comma as they are typed** | Each keystroke was parsed and written back, so "0." became "0" and a trailing comma vanished |
| **Bermudan exercise dates take a new line** | The same, for one date per line |
| **a leg's notionals keep a trailing comma rather than a zero after it** | The same, where the lost character became a zero notional |

### Two invariants asserted in every check

Both are shipped defects rather than hypotheticals, so they are enforced
everywhere rather than in one test:

- **No console errors, and no unmemoised-selector warnings.** This is where a
  selector that builds a new array on every call announces itself. The suite
  found a third one — `TradeBuilder`'s `legKinds` — on its first run, after two
  had already been fixed by hand.
- **The window itself does not scroll.** The panes scroll; the frame does not.

## What the unit and integration suites cover

`npm test` — 203 checks in 32 files. `npm run e2e` — 44 checks in 7 files.

| File | |
| --- | --- |
| `src/market/graph.test.ts` | Dependency extraction, the topological sort, cycles, dangling references |
| `src/market/validation.test.ts` | The market rules, and mapping a backend `market[i]` path back to the object the user authored |
| `src/trade/validation.test.ts` | Option rules: required flags, the dividend-curve trap, engine parameters |
| `src/trade/swapValidation.test.ts` | Swap rules: two legs, opposing directions, a forwarding curve, the fair-rate leg order |
| `src/protocol/capabilities.test.ts` | What the backend will actually dispatch, style by style |
| `src/store/workbookSlice.test.ts` | Reducer holes, and the structural/live edit split |
| `src/store/workbookCodec.test.ts` | Workbook round trips, including the swap with its indices and pillars |
| `src/session/scenario.test.ts` | The three sweep point forms, and that `keep_final_value` defaults off |
| `src/lib/prose.test.ts` | No identifier-shaped word appears in rendered text |
| `src/session/monteCarlo.integration.test.ts` | *(needs the backend)* Progress frames, the cancel between batches, and that batching changes the answer |
| `src/session/compare.integration.test.ts` | *(needs the backend)* Two sessions on one socket, priced independently |
| `src/store/tabsSlice.test.ts` | A socket that dies takes the parked tabs' sessions with it, not only the visible one — and leaves the active tab alone, whose state is not a snapshot |
| `src/session/book.test.ts` | Reading a `BatchResult`: prices survive around a failing row, the rejection lands on the row it belongs to with the row prefix stripped, labels zip back on by position, and an abandoned book is a full one with reasons rather than a short one. Plus naming a trade from the trade |
| `src/session/batch.integration.test.ts` | *(needs the backend)* A book answers one entry per trade in order, a failing trade costs only its own row, and every batched price equals the same trade sent alone |
| `src/session/grid.integration.test.ts` | *(needs the backend)* A two-axis sweep comes back row-major, reads as a line per value of the second axis, puts **both** quotes back, refuses the same quote on two axes, and — cancelled part-way — returns the points it had priced with its axis trimmed to match |
| `src/session/quantoLookback.integration.test.ts` | *(needs the backend)* A quanto lookback is refused by name, and a plain one still prices |
| `src/session/impliedVolatility.integration.test.ts` | *(needs the backend)* The round trip: a price handed back as the target implies the 0.2 the market holds, and asking with no target is refused |
| `src/protocol/drift.integration.test.ts` | *(needs the backend)* The capability tables here against what the service advertises |
| `src/protocol/drift.test.ts` | The drift check itself: engine methods, finite-difference presets and result kinds, which it claimed to compare and did not |
| `src/protocol/client.test.ts` | The socket: requests held through a drop and released or failed per session, one connect and one reconnect timer at a time, the token in the subprotocol list, and a socket that cannot even be constructed saying disconnected |
| `src/protocol/middleware.test.ts` | An answer for a tab no longer in front goes to that tab, not to the one on screen; a sweep's cancel goes to the session the sweep runs in |
| `src/protocol/socketUrl.test.ts` | Where the page dials: a full URL, a path on the serving host, or the loopback default |
| `src/lib/parse.test.ts` | The list parsers behind every typed list: a half-typed value is no value yet, and each reads back what it formats |
| `src/store/persistence.test.ts` | Every tab saved and restored in order, the older single-workbook save read once, and a save that cannot be read kept aside rather than overwritten |
| `src/store/bookSlice.test.ts` | A priced book goes with the document it was priced from |
| `src/store/requestsSlice.test.ts` | A progress frame without a running NPV draws nothing in the trace, rather than a price of zero |
| `src/store/selectors.test.ts` | The Monte Carlo panel's final value is its own run's; the market choices a card offers hold still while a quote is dragged |
| `src/trade/payoffStyle.test.ts` | A payoff the style cannot take is refused here rather than by the service |
| `src/session/ops.test.ts` | Opening after a lost session; a cancel that cannot be sent or is refused settles quietly |
| `src/session/tabs.test.ts` | Closing a tab acts on the tabs as they are when the close comes back |
| `src/session/repricer.test.ts` | A quote dragged in a tab switched to mid-round-trip is still sent, to its own session |
| `src/devtools/pythonSnippet.test.ts` | Copy as Python dials the page's own service, takes a token from `QL_TOKEN` without writing one down, and is offered for outbound frames only |

`src/lib/prose.test.ts` is the odd one and worth knowing about. A mechanical
rename leaked into user-visible text twice — "matches HANDLERS.md" became
"isReference HANDLERS.md", and "off the live graph" became "off the isLive
graph" — and neither the compiler nor the linter can see
that class. It was written, watched to fail on the real bug, then watched to
pass; the first version of it silently passed because its exclusion list
contained a semicolon and the sentence had one.

## Writing a new end-to-end check

Two traps, both learned the hard way here:

- **Mantine labels a `Select`'s input and its listbox alike.** `getByLabel` is
  ambiguous; ask for `getByRole("textbox", {name: "..."})`.
- **The market pane renders quote ids in the same markup as the quote bar.**
  Scope to the strip with `getByTestId("quote-bar")` rather than taking the
  first match on the page. Chasing this cost a while as a suspected regression
  before it turned out to be the locator.

Checks that need the daemon go behind `test.skip(!hasBackend, ...)` using the
probe in `e2e/fixtures.ts`, never behind an early `return`.

## What is not covered

- **No visual regression.** Layout is checked by invariant — does the window
  scroll — not by pixels. Contrast and accessible names are checked; the look
  is not.
- **Nothing provokes `WORKER_DIED`.** It is the one error the client cannot
  cause on purpose: a hostile server is the only way to send it, and there
  isn't one here. It reaches `classifyError`'s `default` and is reported as
  infrastructure by omission rather than by decision. `PLAN.md` §10 records
  this as the gap the mock socket server would have filled.
- **No restart-under-load check.** The socket being *cut* is covered — the
  parked-tab check in `e2e/tabs.spec.ts` does it for real — but killing the
  backend mid-suite and bringing it back is a fixture nobody has written.
- **CI does not run any of this yet.** The pre-push hook runs lint, format and
  `npm test`; the end-to-end suite is explicit, because it wants a backend and
  a browser.

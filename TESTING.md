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

**The backend does not start itself.** Three of the ten checks need it and are
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

Ten checks in `e2e/`. Each one exists because of a defect this project actually
shipped, or a claim nothing else can verify.

### `e2e/app.spec.ts` — the app, and the option path

| Check | What it guards |
| --- | --- |
| **loads and shows the market it will open with** | The app boots, reaches the socket, and lists the seven seed objects. The smoke test everything else depends on |
| **the frame never scrolls, however tall the trade gets** | Loads the swap — the tallest thing this app builds — and asserts the window still does not scroll. When this broke, every control moved out from under the pointer mid-interaction |
| **prices the HANDLERS.md reference** *(needs the backend)* | Open, bump, price, and `12.459717` on screen with its badge. The number the backend's own documentation records |
| **an answered required field stops saying it is required** | Switch to American, see the approximation demanded, answer it, and watch the demand go away. This is the exact defect that shipped past a green unit suite: the engine parameter setters wrote only into a block that already existed, so the first choice was dropped and the control went on claiming to be unanswered |
| **closed engines say why they are closed** | On an American exercise the integral and Monte Carlo options are disabled *and* carry the backend's own reason. Gating without a reason is a dead end for the user |

### `e2e/m6.spec.ts` — the long-running panels and the document

| Check | What it guards |
| --- | --- |
| **the bottom strip opens on each of its three tabs** | Sweep, Monte Carlo and compare each render, and none of them makes the window scroll |
| **a batched Monte Carlo reports progress and settles** *(needs the backend)* | 200,000 paths in batches of 20,000: the progress reaches `200,000 of 200,000`, the convergence trace appears, and the 95% band is shown. The whole point of batching |
| **compare prices the same trade in a second session** *(needs the backend)* | A variant evaluation date prices in its own session; base, variant and a negative difference all render, and the primary session is still live afterwards. The one capability the gateway advertises that nothing else here uses |
| **the workbook survives a reload** | Load the swap example, reload, and the index and pillar quotes are still there. Persistence end to end, through the codec and local storage |
| **a fixed leg's rate says why it cannot be dragged** | `FixedRateLeg` reads its rate once at construction, so a slider on that quote would lie. The check is that it *explains itself*, not merely that it is disabled |

### `e2e/tabs.spec.ts` — several workbooks, several sessions

| Check | What it guards |
| --- | --- |
| **a new tab starts from the seed and does not disturb the first** | The second tab is a fresh workbook rather than a copy, and going back finds the first as it was left |
| **each tab keeps its own session, both open on one socket** *(needs the backend)* | Two session ids, and the first still live when you return to it rather than reopened |
| **a price in one tab does not land in the other** *(needs the backend)* | The middleware mirrors every frame into the store, so this is the check that a reply is matched to the session that asked |
| **closing a tab returns to the one beside it** | And the last tab cannot be closed: there is always somewhere to be |

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

### Two invariants asserted in every check

Both are shipped defects rather than hypotheticals, so they are enforced
everywhere rather than in one test:

- **No console errors, and no unmemoised-selector warnings.** This is where a
  selector that builds a new array on every call announces itself. The suite
  found a third one — `TradeBuilder`'s `legKinds` — on its first run, after two
  had already been fixed by hand.
- **The window itself does not scroll.** The panes scroll; the frame does not.

## What the unit and integration suites cover

`npm test` — 81 checks. `npm run e2e` — 18 checks.

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

`src/lib/prose.test.ts` is the odd one and worth knowing about. A mechanical
rename leaked into user-visible text three times — "matches HANDLERS.md" became
"isReference HANDLERS.md" — and neither the compiler nor the linter can see
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
  scroll — not by pixels.
- **No reconnect-and-replay check.** It is exercised by hand and works; killing
  the backend mid-suite and restarting it is a fixture nobody has written.
- **No visual regression, still.** Contrast and names are checked; the look is not.
- **CI does not run any of this yet.** The pre-push hook runs lint, format and
  `npm test`; the end-to-end suite is explicit, because it wants a backend and
  a browser.

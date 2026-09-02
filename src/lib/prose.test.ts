import {globSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

/** Renaming a variable must not rewrite what the user reads.
 *
 *  Twice now a word-boundary rename has walked out of the code and into a
 *  label — "matches HANDLERS.md" became "isReference HANDLERS.md", and "off
 *  the live graph" became "off the isLive graph". Neither tsc nor eslint can
 *  see it, and both survived a browser pass. This does what reading the diff
 *  did not.
 */
const CAMEL_IN_PROSE = /\b(?:is|has|should|are|can|did|will)[A-Z][a-zA-Z]*\b/;

const sources = globSync("src/**/*.{ts,tsx}", {exclude: name => name.includes("/gen/")});

describe("rendered text", () => {
    it("contains no identifier-shaped words", () => {
        const offenders: string[] = [];
        for (const file of sources) {
            readFileSync(file, "utf8")
                .split("\n")
                .forEach((line: string, at: number) => {
                    const trimmed = line.trim();
                    // JSX text: a line that is neither markup nor an
                    // expression, sitting inside an element.
                    // A JSX text node: words and punctuation, no syntax.
                    // A JSX text node: capitalised words and sentence
                    // punctuation, with none of the syntax a code line has.
                    // Semicolons stay allowed — prose contains them, and the
                    // line this test exists for is "No live session. Values
                    // still edit the workbook; open a session...".
                    const isProse = /^[A-Z]/.test(trimmed) && / /.test(trimmed) && !/[{}=<>:?()[\]"`]/.test(trimmed);
                    if (isProse && CAMEL_IN_PROSE.test(trimmed)) {
                        offenders.push(`${file}:${at + 1}: ${trimmed}`);
                    }
                });
        }
        expect(offenders).toEqual([]);
    });
});

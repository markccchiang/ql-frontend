import {describe, expect, it} from "vitest";

import {formatFixingRows, formatNumberList, parseFixingRows, parseLabels, parseLines, parseNumberList} from "./parse";

describe("parseNumberList", () => {
    it("reads numbers separated by commas or spaces", () => {
        expect(parseNumberList("0.8, 0.9 1.1,1.2")).toEqual([0.8, 0.9, 1.1, 1.2]);
        expect(parseNumberList("-0.25, 1e6")).toEqual([-0.25, 1e6]);
    });

    it("reads a trailing comma or space as nothing, not as a zero", () => {
        expect(parseNumberList("0.8, ")).toEqual([0.8]);
        expect(parseNumberList("1000000, ")).toEqual([1000000]);
        expect(parseNumberList("")).toEqual([]);
    });

    it("is not a value while a number is still being typed", () => {
        for (const text of ["-", "0.", "1e", "0.8, 0.", "12a"]) expect(parseNumberList(text), text).toBeNull();
    });

    it("reads back what it formats", () => {
        expect(parseNumberList(formatNumberList([0.85, 1.15]))).toEqual([0.85, 1.15]);
    });
});

describe("parseLines and parseLabels", () => {
    it("drop blank lines and empty labels rather than keeping them", () => {
        expect(parseLines("2027-03-01\n\n 2027-06-01 \n")).toEqual(["2027-03-01", "2027-06-01"]);
        expect(parseLabels("S1, , S2,")).toEqual(["S1", "S2"]);
    });
});

describe("parseFixingRows", () => {
    it("reads one fixing per line", () => {
        expect(parseFixingRows("2026-08-03 0.031\n2026-08-04, 0.0312\n")).toEqual([
            {date: "2026-08-03", value: 0.031},
            {date: "2026-08-04", value: 0.0312}
        ]);
    });

    it("is not a value while any line is incomplete", () => {
        for (const text of ["2026-08-0 0.031", "2026-08-03", "2026-08-03 0.", "2026-08-03 abc", "2026-08-03 0.03 1"]) {
            expect(parseFixingRows(text), text).toBeNull();
        }
    });

    it("reads back what it formats", () => {
        const rows = [{date: "2026-08-03", value: 0.031}];
        expect(parseFixingRows(formatFixingRows(rows))).toEqual(rows);
    });
});

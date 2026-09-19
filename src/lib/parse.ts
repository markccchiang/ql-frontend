/** The text formats of the fields that hold a list, and how each reads back.
 *
 *  The pure half of components/ParsedText.tsx. Every parser returns null for
 *  text that is not a value yet -- a "-" on its way to a negative number, a
 *  "0." on its way to 0.25, a fixing with its date half typed -- so the field
 *  can keep what is being typed without committing it.
 */

/** A number as typed in full: no trailing ".", "e" or sign still waiting for
 *  its digits. */
const NUMBER = /^[-+]?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Numbers separated by commas or spaces. Empty tokens -- a trailing comma, a
 *  double space -- are nothing rather than zero. */
export function parseNumberList(text: string): number[] | null {
    const tokens = text.split(/[,\s]+/).filter(token => token !== "");
    return tokens.every(token => NUMBER.test(token)) ? tokens.map(Number) : null;
}

export function formatNumberList(values: readonly number[]): string {
    return values.join(", ");
}

/** One entry per line, trimmed; blank lines are not entries. */
export function parseLines(text: string): string[] {
    return text
        .split("\n")
        .map(line => line.trim())
        .filter(line => line !== "");
}

export function formatLines(lines: readonly string[]): string {
    return lines.join("\n");
}

/** Comma-separated labels, trimmed; an empty one is not a label. */
export function parseLabels(text: string): string[] {
    return text
        .split(",")
        .map(part => part.trim())
        .filter(part => part !== "");
}

export function formatLabels(labels: readonly string[]): string {
    return labels.join(", ");
}

export interface FixingRow {
    date: string;
    value: number;
}

/** One fixing per line: an ISO date, then the value. Null until every line is
 *  one: a fixings edit reaches the live graph, and a half-typed row is not a
 *  fixing -- nor is a row whose date is mid-edit a fixing that was removed. */
export function parseFixingRows(text: string): FixingRow[] | null {
    const rows: FixingRow[] = [];
    for (const line of parseLines(text)) {
        const parts = line.split(/[\s,]+/);
        if (parts.length !== 2) return null;
        const [date, value] = parts as [string, string];
        if (!ISO_DATE.test(date) || !NUMBER.test(value)) return null;
        rows.push({date, value: Number(value)});
    }
    return rows;
}

export function formatFixingRows(rows: readonly FixingRow[]): string {
    return rows.map(row => `${row.date} ${row.value}`).join("\n");
}

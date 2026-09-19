import {Select, Text} from "@mantine/core";

import type {FixingSeries} from "@/gen/quantlib/v2/market_pb";
import {formatFixingRows, parseFixingRows} from "@/lib/parse";
import type {Issue} from "@/market/validation";
import {bumpFixings} from "@/session/repricer";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {ParsedTextarea} from "../ParsedText";

/** Past fixings for one index.
 *
 *  Graph input rather than graph structure: a leg whose current period has
 *  already fixed cannot price without them, and they can arrive in an
 *  UpdateMarket rather than forcing a new session.
 */
export const FixingsEditor = ({id, fixings, issues}: {id: string; fixings: FixingSeries; issues: Issue[]}) => {
    const dispatch = useAppDispatch();
    const market = useAppSelector(state => state.workbook.market);
    const indices = market.filter(object => object.kind.case === "index").map(object => ({value: object.id, label: object.id}));
    const errorFor = (path: string) => issues.find(issue => issue.path === path && issue.severity === "error")?.message;

    const rows = fixings.fixings.map(row => ({date: row.date?.form.case === "iso" ? row.date.form.value : "", value: row.value}));

    return (
        <>
            <Select
                size="xs"
                label="index"
                placeholder="pick one"
                data={indices}
                error={errorFor("fixings.index_id")}
                value={fixings.indexId || null}
                onChange={value => dispatch(workbookActions.fixingsIndexSet({id, indexId: value ?? ""}))}
            />
            <ParsedTextarea
                size="xs"
                mt={6}
                label="fixings"
                description="one per line: ISO date, then the rate as a decimal"
                autosize
                minRows={3}
                value={rows}
                format={formatFixingRows}
                parse={parseFixingRows}
                onValue={next => {
                    // Only once every line is a whole fixing. A date being
                    // retyped used to commit as a fixing removed -- a rebuild
                    // per keystroke -- and a value mid-edit as a rate of zero.
                    dispatch(workbookActions.fixingsRowsSet({id, rows: next}));
                    // The other edit a live graph can take: complete rows go
                    // out as an UpdateMarket, coalesced like a slider drag.
                    void dispatch(bumpFixings(id));
                }}
            />
            <Text fz={10} c="dimmed" mt={4}>
                Adding or changing a fixing reaches the live session as an update: fixings are graph input, not graph structure. Removing one needs a rebuild, because a fixing cannot be un-added.
            </Text>
        </>
    );
};

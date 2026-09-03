import {Button, Group, NumberInput, Paper, Text, Tooltip} from "@mantine/core";

import {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {canImplyVolatility, type StyleCase} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {useFieldIssue} from "./useFieldIssue";

/** The one result that is a question rather than a reading.
 *
 *  Every other kind is computed off the market the session already holds.
 *  An implied volatility is a root find, so the price to invert has to travel
 *  with the request — ask for the kind without one and the service refuses,
 *  because inverting the price it is about to compute would hand back the
 *  volatility that was sent in.
 */
export const ImpliedVolatilityCard = () => {
    const dispatch = useAppDispatch();
    const isWanted = useAppSelector(state => state.workbook.trade.results.includes(ResultKind.IMPLIED_VOLATILITY));
    const implied = useAppSelector(state => state.workbook.trade.impliedVolatility);
    const style = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" ? ((kind.value.style.case ?? "vanilla") as StyleCase) : undefined;
    });
    const lastNpv = useAppSelector(state => state.results.latest?.npv ?? null);

    const targetIssue = useFieldIssue("implied_volatility.target_price");
    const bracketIssue = useFieldIssue("implied_volatility.max_volatility");

    if (!isWanted) return null;

    const set = (field: "targetPrice" | "accuracy" | "minVolatility" | "maxVolatility") => (value: number | string) => dispatch(workbookActions.impliedVolatilitySet({field, value: typeof value === "number" ? value : Number(value) || 0}));

    return (
        <Paper>
            <Text fz="xs" fw={500}>
                implied volatility
            </Text>
            <Text fz={10} c="dimmed">
                the price to invert, and the search to invert it in
            </Text>

            {!canImplyVolatility(style) && (
                <Text fz={10} c="orange" mt={4}>
                    QuantLib inverts a vanilla, a barrier and a double barrier. On this style the result comes back named absent.
                </Text>
            )}

            <Group gap="xs" align="flex-end" mt={6}>
                <NumberInput
                    size="xs"
                    flex={1}
                    label="target price"
                    description="the price the volatility has to reproduce"
                    decimalScale={6}
                    step={0.01}
                    error={targetIssue?.severity === "error" ? targetIssue.message : undefined}
                    value={implied?.targetPrice ?? ""}
                    onChange={set("targetPrice")}
                />
                <Tooltip label={lastNpv === null ? "Nothing priced yet." : `Fill in ${lastNpv.toFixed(6)}, the NPV of the last price.`}>
                    <Button size="xs" variant="default" disabled={lastNpv === null} onClick={() => lastNpv !== null && dispatch(workbookActions.impliedVolatilitySet({field: "targetPrice", value: lastNpv}))}>
                        from last price
                    </Button>
                </Tooltip>
            </Group>

            <Group gap="xs" grow mt={6}>
                <NumberInput size="xs" label="accuracy" description="0 leaves QuantLib's own" decimalScale={8} step={0.0001} value={implied?.accuracy ?? ""} onChange={set("accuracy")} />
                <NumberInput size="xs" label="min volatility" description="0 leaves QuantLib's own" decimalScale={4} step={0.01} value={implied?.minVolatility ?? ""} onChange={set("minVolatility")} />
                <NumberInput
                    size="xs"
                    label="max volatility"
                    description="0 leaves QuantLib's own"
                    decimalScale={4}
                    step={0.1}
                    error={bracketIssue?.severity === "error" ? bracketIssue.message : undefined}
                    value={implied?.maxVolatility ?? ""}
                    onChange={set("maxVolatility")}
                />
            </Group>
        </Paper>
    );
};

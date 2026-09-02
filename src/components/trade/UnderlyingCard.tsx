import {Paper, Select, Text} from "@mantine/core";
import {asQuote, asVolatility, asYieldCurve} from "@/market/model";
import {PROCESSES, rejectsDividendCurve} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";
import {ChoiceSelect} from "./ChoiceSelect";
import {useFieldIssue} from "./useFieldIssue";

const BASE = "instrument.option.underlyings[0]";

export function UnderlyingCard() {
    const dispatch = useAppDispatch();
    const market = useAppSelector(state => state.workbook.market);
    const underlying = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" ? kind.value.underlyings[0] : undefined;
    });

    const spotIssue = useFieldIssue(`${BASE}.spot_quote_id`);
    const discountIssue = useFieldIssue(`${BASE}.discount_curve_id`);
    const dividendIssue = useFieldIssue(`${BASE}.dividend_curve_id`);
    const volIssue = useFieldIssue(`${BASE}.volatility_id`);
    const processIssue = useFieldIssue(`${BASE}.process`);

    if (!underlying) return null;

    const ids = (predicate: (id: string) => boolean) =>
        market
            .filter(object => predicate(object.id))
            .map(object => ({
                value: object.id,
                label: object.displayName ? `${object.id} — ${object.displayName}` : object.id
            }));
    const quotes = ids(id => asQuote(market.find(o => o.id === id)!) !== null);
    const curves = ids(id => asYieldCurve(market.find(o => o.id === id)!) !== null);
    const surfaces = ids(id => asVolatility(market.find(o => o.id === id)!) !== null);

    const noDividend = rejectsDividendCurve(underlying.process);

    const ref = (
        label: string,
        field: "spotQuoteId" | "discountCurveId" | "dividendCurveId" | "volatilityId",
        data: {value: string; label: string}[],
        issue: ReturnType<typeof useFieldIssue>,
        extra?: {disabled?: boolean; description?: string; clearable?: boolean}
    ) => (
        <Select
            size="xs"
            mt={6}
            label={label}
            placeholder={extra?.disabled ? "not applicable" : "pick one"}
            description={extra?.description}
            data={issue?.knownIds ? issue.knownIds.map(id => ({value: id, label: id})) : data}
            value={underlying[field] || null}
            error={issue?.severity === "error" ? issue.message : undefined}
            disabled={extra?.disabled ?? false}
            clearable={extra?.clearable ?? false}
            searchable
            onChange={value => dispatch(workbookActions.underlyingRefSet({field, value: value ?? ""}))}
        />
    );

    return (
        <Paper>
            <Text fw={600} fz="xs" tt="uppercase" c="dimmed" mb={6}>
                underlying
            </Text>

            <ChoiceSelect label="process" choices={PROCESSES} value={underlying.process} error={processIssue?.severity === "error" ? processIssue.message : undefined} onChange={next => dispatch(workbookActions.processSet(next))} />

            {ref("spot", "spotQuoteId", quotes, spotIssue)}
            {ref("discount curve", "discountCurveId", curves, discountIssue)}
            {ref("dividend curve", "dividendCurveId", curves, dividendIssue, {
                disabled: noDividend,
                clearable: true,
                // The one default worth stating: omitting it is a flat zero yield, not
                // the risk-free curve.
                description: noDividend ? "Black-Scholes has no dividend yield" : underlying.dividendCurveId ? undefined : "empty means a flat zero dividend yield"
            })}
            {ref("volatility", "volatilityId", surfaces, volIssue)}

            {dividendIssue?.severity === "warning" && (
                <Text fz={10} c="yellow" mt={4}>
                    {dividendIssue.message}
                </Text>
            )}
        </Paper>
    );
}

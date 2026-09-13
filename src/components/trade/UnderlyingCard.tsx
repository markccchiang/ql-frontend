import {ActionIcon, Button, Group, Paper, Select, Text, TextInput} from "@mantine/core";

import {asQuote, asVolatility, asYieldCurve} from "@/market/model";
import {PROCESSES, rejectsDividendCurve} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {ChoiceSelect} from "./ChoiceSelect";
import {useFieldIssue} from "./useFieldIssue";

/** One asset. Only a basket has more than one, and the card is repeated per
 *  asset rather than made into a list, because every field on it is the same
 *  field the single-asset styles have. */
const Asset = ({index, count}: {index: number; count: number}) => {
    const dispatch = useAppDispatch();
    const market = useAppSelector(state => state.workbook.market);
    const underlying = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" ? kind.value.underlyings[index] : undefined;
    });

    const base = `instrument.option.underlyings[${index}]`;
    const spotIssue = useFieldIssue(`${base}.spot_quote_id`);
    const discountIssue = useFieldIssue(`${base}.discount_curve_id`);
    const dividendIssue = useFieldIssue(`${base}.dividend_curve_id`);
    const volIssue = useFieldIssue(`${base}.volatility_id`);
    const processIssue = useFieldIssue(`${base}.process`);
    const labelIssue = useFieldIssue(`${base}.label`);

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

    const hasNoDividend = rejectsDividendCurve(underlying.process);

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
            onChange={value => dispatch(workbookActions.underlyingRefSet({field, value: value ?? "", index}))}
        />
    );

    return (
        <Paper>
            <Group justify="space-between" mb={6}>
                <Text fw={600} fz="xs" tt="uppercase" c="dimmed">
                    {count > 1 ? `underlying ${index + 1} of ${count}` : "underlying"}
                </Text>
                {count > 1 && (
                    <ActionIcon size="xs" variant="subtle" color="gray" aria-label={`remove underlying ${index + 1}`} onClick={() => dispatch(workbookActions.underlyingRemoved(index))}>
                        ×
                    </ActionIcon>
                )}
            </Group>

            {count > 1 && (
                <TextInput
                    size="xs"
                    mb={6}
                    label="label"
                    description="what the correlation matrix indexes this asset on"
                    error={labelIssue?.severity === "error" ? labelIssue.message : undefined}
                    value={underlying.label}
                    onChange={event => dispatch(workbookActions.underlyingLabelSet({index, value: event.currentTarget.value}))}
                />
            )}

            <ChoiceSelect
                label="process"
                choices={PROCESSES}
                value={underlying.process}
                error={processIssue?.severity === "error" ? processIssue.message : undefined}
                onChange={next => dispatch(workbookActions.processSet({process: next, index}))}
            />

            {ref("spot", "spotQuoteId", quotes, spotIssue)}
            {ref("discount curve", "discountCurveId", curves, discountIssue)}
            {ref("dividend curve", "dividendCurveId", curves, dividendIssue, {
                disabled: hasNoDividend,
                clearable: true,
                // The one default worth stating: omitting it is a flat zero yield, not
                // the risk-free curve.
                description: hasNoDividend ? "Black-Scholes has no dividend yield" : underlying.dividendCurveId ? undefined : "empty means a flat zero dividend yield"
            })}
            {ref("volatility", "volatilityId", surfaces, volIssue)}

            {dividendIssue?.severity === "warning" && (
                <Text fz={10} c="yellow" mt={4}>
                    {dividendIssue.message}
                </Text>
            )}
        </Paper>
    );
};

export const UnderlyingCard = () => {
    const dispatch = useAppDispatch();
    const count = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" ? kind.value.underlyings.length : 0;
    });
    const isBasket = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" && kind.value.style.case === "basket";
    });
    const countIssue = useFieldIssue("instrument.option.underlyings");

    if (count === 0) return null;

    return (
        <>
            {Array.from({length: count}, (_, index) => (
                <Asset key={index} index={index} count={count} />
            ))}
            {countIssue?.severity === "error" && (
                <Text fz="xs" c="red">
                    {countIssue.message}
                </Text>
            )}
            {isBasket && (
                <Button size="compact-xs" variant="default" onClick={() => dispatch(workbookActions.underlyingAdded())}>
                    Add an Asset
                </Button>
            )}
        </>
    );
};

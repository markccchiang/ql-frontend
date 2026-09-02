import {Paper, Select, Switch, Text, Tooltip} from "@mantine/core";

import {asQuote, asVolatility, asYieldCurve} from "@/market/model";
import {quantoSupport, type StyleCase} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {useFieldIssue} from "./useFieldIssue";

const BASE = "instrument.option.quanto";

/** Quanto is not a product.
 *
 *  QuantoEngine\<Instr, Engine\> wraps another engine rather than another
 *  instrument, so this sits outside the style oneof and names the FX leg and
 *  nothing else. It needs all three ids or none.
 */
export const QuantoCard = () => {
    const dispatch = useAppDispatch();
    const market = useAppSelector(state => state.workbook.market);
    const option = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" ? kind.value : undefined;
    });

    const curveIssue = useFieldIssue(`${BASE}.fx_risk_free_curve_id`);
    const volIssue = useFieldIssue(`${BASE}.fx_volatility_id`);
    const correlationIssue = useFieldIssue(`${BASE}.correlation_id`);

    if (!option) return null;
    const style = (option.style.case ?? "vanilla") as StyleCase;
    const support = quantoSupport(style);
    const quanto = option.quanto;
    const isOn = quanto !== undefined;

    const options = (predicate: (id: string) => boolean) => market.filter(entry => predicate(entry.id)).map(entry => ({value: entry.id, label: entry.displayName ? `${entry.id} — ${entry.displayName}` : entry.id}));
    const curves = options(id => asYieldCurve(market.find(entry => entry.id === id)!) !== null);
    const surfaces = options(id => asVolatility(market.find(entry => entry.id === id)!) !== null);
    const quotes = options(id => asQuote(market.find(entry => entry.id === id)!) !== null);

    return (
        <Paper>
            <Tooltip label={support.reason ?? "Wraps the engine in a QuantoEngine and adjusts the dividend yield through a QuantoTermStructure."} multiline w={280}>
                <Switch size="xs" label="quanto" checked={isOn} disabled={support.availability !== "supported"} onChange={event => dispatch(workbookActions.quantoToggled(event.currentTarget.checked))} />
            </Tooltip>

            {support.availability !== "supported" && (
                <Text fz={10} c="dimmed" mt={4}>
                    {support.reason}
                </Text>
            )}

            {isOn && quanto && (
                <>
                    <Select
                        size="xs"
                        mt={6}
                        label="FX risk-free curve"
                        description="the currency the payoff settles in"
                        placeholder="pick one"
                        data={curves}
                        searchable
                        error={curveIssue?.severity === "error" ? curveIssue.message : undefined}
                        value={quanto.fxRiskFreeCurveId || null}
                        onChange={value => dispatch(workbookActions.quantoRefSet({field: "fxRiskFreeCurveId", value: value ?? ""}))}
                    />
                    <Select
                        size="xs"
                        mt={6}
                        label="FX volatility"
                        placeholder="pick one"
                        data={surfaces}
                        searchable
                        error={volIssue?.severity === "error" ? volIssue.message : undefined}
                        value={quanto.fxVolatilityId || null}
                        onChange={value => dispatch(workbookActions.quantoRefSet({field: "fxVolatilityId", value: value ?? ""}))}
                    />
                    <Select
                        size="xs"
                        mt={6}
                        label="correlation"
                        description="a quote in [-1, 1]; the backend checks, because QuantoTermStructure does not"
                        placeholder="pick one"
                        data={quotes}
                        searchable
                        error={correlationIssue?.severity === "error" ? correlationIssue.message : undefined}
                        value={quanto.correlationId || null}
                        onChange={value => dispatch(workbookActions.quantoRefSet({field: "correlationId", value: value ?? ""}))}
                    />
                </>
            )}
        </Paper>
    );
};

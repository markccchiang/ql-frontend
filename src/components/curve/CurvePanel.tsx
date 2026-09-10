import {useMemo, useState} from "react";
import {Alert, Button, Group, NumberInput, Select, Text} from "@mantine/core";

import {CurveSample_Quantity} from "@/gen/quantlib/v2/envelope_pb";
import {asVolatility, asYieldCurve} from "@/market/model";
import {isVolatilityQuantity, sampleCurve} from "@/session/curves";
import {curveActions} from "@/store/curveSlice";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {uiActions} from "@/store/uiSlice";

import {LadderChart} from "../scenario/LadderChart";

const QUANTITIES = [
    {value: String(CurveSample_Quantity.DISCOUNT_FACTOR), label: "discount factor"},
    {value: String(CurveSample_Quantity.ZERO_RATE), label: "zero rate"},
    {value: String(CurveSample_Quantity.FORWARD_RATE), label: "forward rate"},
    {value: String(CurveSample_Quantity.BLACK_VOLATILITY), label: "black volatility"}
];

/** The term structure the engine priced with.
 *
 *  Sampled by the backend off the handle it just used and sent back as a
 *  series. Drawing it from the curve definition instead would mean
 *  re-implementing QuantLib's interpolation here, and then showing a curve
 *  nothing was priced against — which is the whole reason CurveSample exists.
 */
export const CurvePanel = () => {
    const dispatch = useAppDispatch();
    const curve = useAppSelector(state => state.curve);
    // The most points one sample may ask for, from the handshake; a chart
    // shows hundreds, and the input stops at what the service would refuse.
    const maxPoints = useAppSelector(state => state.capabilities.reported?.maxCurveSamplePoints || 2000);
    const market = useAppSelector(state => state.workbook.market);
    const isLive = useAppSelector(state => state.session.status === "live");
    const [isBusy, setBusy] = useState(false);

    const isVol = isVolatilityQuantity(curve.quantity);
    const sources = market.filter(object => (isVol ? asVolatility(object) !== null : asYieldCurve(object) !== null)).map(object => ({value: object.id, label: object.displayName ? `${object.id} — ${object.displayName}` : object.id}));
    const line = curve.lines[0];
    // Memoised because LadderChart rebuilds on a new `lines` identity.
    const curveLines = useMemo(() => (line ? [{label: line.name, y: line.y as (number | null)[]}] : []), [line]);

    return (
        <div style={{display: "flex", gap: 12, height: "100%"}}>
            <div style={{width: 260, overflowY: "auto", flexShrink: 0}}>
                <Group justify="space-between" mb={6}>
                    <Text fw={600} fz="sm">
                        Curve
                    </Text>
                    <Group gap={4}>
                        <Button
                            size="compact-xs"
                            disabled={!isLive}
                            loading={isBusy}
                            onClick={() => {
                                setBusy(true);
                                void dispatch(sampleCurve())
                                    .catch(() => undefined)
                                    .finally(() => setBusy(false));
                            }}
                        >
                            sample
                        </Button>
                        <Button size="compact-xs" variant="subtle" onClick={() => dispatch(uiActions.bottomPanelSet(null))}>
                            hide
                        </Button>
                    </Group>
                </Group>

                <Select size="xs" label="quantity" data={QUANTITIES} value={String(curve.quantity)} onChange={value => value && dispatch(curveActions.changed({quantity: Number(value), marketId: ""}))} />
                <Select size="xs" mt={6} label={isVol ? "surface" : "curve"} placeholder="pick one" data={sources} searchable value={curve.marketId || null} onChange={value => dispatch(curveActions.changed({marketId: value ?? ""}))} />
                <Group gap={6} grow mt={6} align="flex-start">
                    <NumberInput size="xs" label="years" min={0.1} value={curve.years} onChange={value => dispatch(curveActions.changed({years: Number(value) || 1}))} />
                    <NumberInput size="xs" label="points" min={2} max={maxPoints} value={curve.points} onChange={value => dispatch(curveActions.changed({points: Math.min(maxPoints, Number(value) || 2)}))} />
                </Group>
                {isVol && <NumberInput size="xs" mt={6} label="strike" description="one strike: several would be a matrix" value={curve.strike} onChange={value => dispatch(curveActions.changed({strike: Number(value) || 0}))} />}

                <Text fz={10} c="dimmed" mt={6}>
                    Sampled by the service off the handle the engine priced against, not rebuilt here.
                </Text>

                {curve.error && (
                    <Alert color="red" p="xs" mt={8}>
                        <Text fz="xs">{curve.error}</Text>
                    </Alert>
                )}
            </div>

            <div style={{flex: 1, minWidth: 0, display: "flex", flexDirection: "column"}}>
                {line && line.x.length > 1 ? (
                    <>
                        <Text fz="xs" fw={600} mb={2}>
                            {line.name} against years
                        </Text>
                        <div style={{flex: 1, minHeight: 0}}>
                            <LadderChart x={line.x} lines={curveLines} xLabel="years" />
                        </div>
                    </>
                ) : (
                    <Group h="100%" justify="center">
                        <Text fz="xs" c="dimmed">
                            No sample yet. Pick a curve and press sample; it comes back with the next price.
                        </Text>
                    </Group>
                )}
            </div>
        </div>
    );
};

import {useCallback, useState} from "react";
import {Alert, Badge, Button, Group, Paper, Progress, Select, Text, Tooltip} from "@mantine/core";

import {type ResultKind} from "@/gen/quantlib/v2/results_pb";
import {formatQuote} from "@/lib/units";
import {asQuote} from "@/market/model";
import {optionResultKinds} from "@/protocol/capabilities";
import {bumpQuote} from "@/session/repricer";
import {cancelScenario, pointCount, runScenario} from "@/session/scenario";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {scenarioActions} from "@/store/scenarioSlice";
import {selectQuotes} from "@/store/selectors";
import {uiActions} from "@/store/uiSlice";

import {AxisCard} from "./AxisCard";
import {LadderChart} from "./LadderChart";

/** A plot has two dimensions. A third axis would price fine and draw nothing,
 *  so the panel offers what it can show. */
const MAX_AXES = 2;

/** The sweep.
 *
 *  N prices off one live graph, in one frame. It is the thing the session
 *  model exists for, and the only panel here that could not be built against a
 *  stateless backend. A second axis is the same argument one level up: spot
 *  against five vols is one request rather than five, off a graph none of them
 *  change.
 */
export const ScenarioPanel = () => {
    const dispatch = useAppDispatch();
    const {spec, outcome, runningRequestId, error} = useAppSelector(state => state.scenario);
    const quotes = useAppSelector(selectQuotes);
    const isLive = useAppSelector(state => state.session.status === "live");
    const ceiling = useAppSelector(state => state.capabilities.reported?.maxScenarioPoints ?? 0);
    const isQuanto = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" && kind.value.quanto !== undefined;
    });
    const progress = useAppSelector(state => (runningRequestId ? (state.requests.byId[runningRequestId]?.progress ?? null) : null));
    const [isBusy, setBusy] = useState(false);

    const first = spec.axes[0];
    const swept = quotes.find(object => object.id === first?.quoteId);
    const sweptQuote = swept ? asQuote(swept) : null;

    const run = useCallback(async () => {
        setBusy(true);
        try {
            await dispatch(runScenario());
        } catch {
            // Recorded on the slice and shown below.
        } finally {
            setBusy(false);
        }
    }, [dispatch]);

    const completed = progress ? Number(progress.completed) : 0;
    const total = progress ? Number(progress.total) : 0;

    const points = pointCount(spec);
    // A grid multiplies, so this is worth saying before the round trip rather
    // than after it. The ceiling is the service's own, from the handshake.
    const isOverCeiling = ceiling > 0 && points > ceiling;
    const usedQuotes = spec.axes.map(axis => axis.quoteId);
    const isRepeatingQuote = new Set(usedQuotes).size !== usedQuotes.length;
    const refusal = isOverCeiling
        ? `${points.toLocaleString()} points is over the ${ceiling.toLocaleString()} this service accepts.`
        : isRepeatingQuote
          ? "Two axes are sweeping the same quote: the second would win at every point and the first would move nothing."
          : null;

    return (
        <Paper p="xs" radius={0} style={{border: 0, height: "100%", display: "flex", gap: 12, padding: 0}}>
            {/* Wide enough for the axes side by side. Stacked, a second axis
                pushed the run button and the point count out of a 280px strip,
                and the panel is far wider than the chart needs. */}
            <div style={{width: spec.axes.length > 1 ? 532 : 260, overflowY: "auto", flexShrink: 0}}>
                <Group justify="space-between" mb={6}>
                    <Text fw={600} fz="sm">
                        Sweep
                    </Text>
                    <Group gap={4}>
                        {runningRequestId && (
                            <Button size="compact-xs" color="orange" variant="light" onClick={() => void dispatch(cancelScenario())}>
                                Cancel
                            </Button>
                        )}
                        <Button size="compact-xs" disabled={!isLive || !!runningRequestId || !!refusal} loading={isBusy} onClick={() => void run()}>
                            Run
                        </Button>
                        <Button size="compact-xs" variant="subtle" onClick={() => dispatch(uiActions.bottomPanelSet(null))}>
                            Hide
                        </Button>
                    </Group>
                </Group>

                <Group gap={12} align="flex-start" wrap="nowrap">
                    {spec.axes.map((axis, at) => (
                        <div key={at} style={{width: 260, flexShrink: 0}}>
                            <AxisCard axis={axis} at={at} quotes={quotes.map(object => ({id: object.id, displayName: object.displayName}))} canRemove={spec.axes.length > 1} />
                        </div>
                    ))}
                </Group>

                {spec.axes.length < MAX_AXES && (
                    <Tooltip label="A second quote makes this a grid: one request, one warm graph, a line per value of the new axis." multiline w={260}>
                        <Button size="compact-xs" variant="light" mt={6} fullWidth onClick={() => dispatch(scenarioActions.axisAdded(nextQuote(quotes, usedQuotes)))}>
                            Add an Axis
                        </Button>
                    </Tooltip>
                )}

                <Group justify="space-between" mt={8}>
                    <Text fz={10} c="dimmed">
                        {spec.axes.length === 1 ? "" : `${spec.axes.map(axis => axis.quoteId).join(" × ")} = `}
                        {points.toLocaleString()} prices, one request
                    </Text>
                </Group>

                <Select
                    size="xs"
                    mt={6}
                    label="plot"
                    description="one result kind, for every point of the sweep"
                    data={optionResultKinds(isQuanto)
                        .filter(choice => choice.availability === "supported")
                        .map(choice => ({
                            value: String(choice.value),
                            label: choice.label
                        }))}
                    value={String(spec.plot)}
                    onChange={value => value && dispatch(scenarioActions.specChanged({plot: Number(value) as ResultKind}))}
                />

                {refusal && (
                    <Alert color="orange" p="xs" mt={8}>
                        <Text fz="xs">{refusal}</Text>
                    </Alert>
                )}

                {progress && total > 0 && (
                    <div style={{marginTop: 8}}>
                        <Progress value={(completed / total) * 100} size="sm" />
                        <Text fz="xs" c="dimmed" mt={2}>
                            point {completed} of {total} · running NPV {progress.runningNpv.toFixed(4)}
                        </Text>
                    </div>
                )}

                {error && (
                    <Alert color="red" p="xs" mt={8}>
                        <Text fz="xs">{error}</Text>
                    </Alert>
                )}
            </div>

            <div style={{flex: 1, minWidth: 0, display: "flex", flexDirection: "column"}}>
                {outcome ? (
                    <>
                        <Group justify="space-between" mb={2}>
                            <Group gap={8}>
                                <Text fz="xs" fw={600}>
                                    {outcome.seriesName} against {outcome.axes.map(axis => axis.quoteId).join(" and ")}
                                </Text>
                                <Badge size="xs" variant="light" color="gray">
                                    {outcome.points.length} points
                                </Badge>
                                {outcome.abandonedAfter > 0 && (
                                    <Tooltip label="Cancelled part-way. These points were priced before it stopped and are kept: they cost the same whether or not they are shown." multiline w={280}>
                                        <Badge size="xs" variant="light" color="orange">
                                            cancelled after {outcome.abandonedAfter}
                                        </Badge>
                                    </Tooltip>
                                )}
                                {outcome.lines.some(line => line.y.some(value => value === null)) && (
                                    <Tooltip label="A gap is a point this engine published nothing for — not a zero." multiline w={240}>
                                        <Badge size="xs" variant="light" color="orange">
                                            gaps
                                        </Badge>
                                    </Tooltip>
                                )}
                            </Group>
                            <Text fz="xs" c="dimmed">
                                {sweptQuote && `isLive: ${formatQuote(sweptQuote.value, sweptQuote.unit)}`} · click a point to write it to the market
                            </Text>
                        </Group>
                        <div style={{flex: 1, minHeight: 0}}>
                            <LadderChart
                                x={outcome.x}
                                lines={outcome.lines}
                                xLabel={outcome.axes[0]?.quoteId ?? ""}
                                {...(sweptQuote ? {marker: sweptQuote.value} : {})}
                                onPick={value => outcome.axes[0] && void dispatch(bumpQuote(outcome.axes[0].quoteId, value))}
                            />
                        </div>
                    </>
                ) : (
                    <Group h="100%" justify="center">
                        <Text fz="xs" c="dimmed">
                            No sweep yet. One frame prices the whole ladder off the live graph.
                        </Text>
                    </Group>
                )}
            </div>
        </Paper>
    );
};

/** A quote the sweep is not already moving, so a new axis starts valid. */
function nextQuote(quotes: {id: string}[], used: string[]): string {
    return quotes.find(quote => !used.includes(quote.id))?.id ?? "";
}

import {useCallback, useState} from "react";
import {Alert, Badge, Button, Checkbox, Group, NumberInput, Paper, Progress, SegmentedControl, Select, Text, TextInput, Tooltip} from "@mantine/core";
import {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {asQuote} from "@/market/model";
import {OPTION_RESULT_KINDS} from "@/protocol/capabilities";
import {cancelScenario, runScenario} from "@/session/scenario";
import {bumpQuote} from "@/session/repricer";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {scenarioActions, type PointForm} from "@/store/scenarioSlice";
import {selectQuotes} from "@/store/selectors";
import {formatQuote} from "@/lib/units";
import {LadderChart} from "./LadderChart";

/** The sweep.
 *
 *  N prices off one live graph, in one frame. It is the thing the session
 *  model exists for, and the only panel here that could not be built against a
 *  stateless backend.
 */
export function ScenarioPanel() {
    const dispatch = useAppDispatch();
    const {spec, outcome, runningRequestId, error} = useAppSelector(state => state.scenario);
    const quotes = useAppSelector(selectQuotes);
    const live = useAppSelector(state => state.session.status === "live");
    const progress = useAppSelector(state => (runningRequestId ? (state.requests.byId[runningRequestId]?.progress ?? null) : null));
    const [busy, setBusy] = useState(false);

    const swept = quotes.find(object => object.id === spec.quoteId);
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

    return (
        <Paper p="xs" radius={0} style={{borderLeft: 0, borderRight: 0, borderBottom: 0, height: 260, display: "flex", gap: 12}}>
            <div style={{width: 260, overflowY: "auto", flexShrink: 0}}>
                <Group justify="space-between" mb={6}>
                    <Text fw={600} fz="sm">
                        Sweep
                    </Text>
                    <Group gap={4}>
                        {runningRequestId && (
                            <Button size="compact-xs" color="orange" variant="light" onClick={() => void dispatch(cancelScenario())}>
                                cancel
                            </Button>
                        )}
                        <Button size="compact-xs" disabled={!live || !!runningRequestId} loading={busy} onClick={() => void run()}>
                            run
                        </Button>
                        <Button size="compact-xs" variant="subtle" onClick={() => dispatch(scenarioActions.closed())}>
                            hide
                        </Button>
                    </Group>
                </Group>

                <Select
                    size="xs"
                    label="quote"
                    data={quotes.map(object => ({value: object.id, label: object.displayName ? `${object.id} — ${object.displayName}` : object.id}))}
                    value={spec.quoteId}
                    onChange={value => value && dispatch(scenarioActions.specChanged({quoteId: value}))}
                />

                <Text fz="xs" fw={500} mt={6} mb={2}>
                    points
                </Text>
                <SegmentedControl
                    size="xs"
                    fullWidth
                    value={spec.form}
                    data={[
                        {value: "relative", label: "relative"},
                        {value: "linear", label: "linear"},
                        {value: "explicit", label: "explicit"}
                    ]}
                    onChange={value => dispatch(scenarioActions.specChanged({form: value as PointForm}))}
                />

                {spec.form === "relative" && (
                    <TextInput
                        size="xs"
                        mt={6}
                        label="factors"
                        description="multipliers of the quote's current value"
                        value={spec.factors.join(", ")}
                        onChange={event => dispatch(scenarioActions.specChanged({factors: numbers(event.currentTarget.value)}))}
                    />
                )}
                {spec.form === "linear" && (
                    <Group gap={6} grow mt={6} align="flex-start">
                        <NumberInput size="xs" label="begin" value={spec.begin} onChange={value => dispatch(scenarioActions.specChanged({begin: Number(value) || 0}))} />
                        <NumberInput size="xs" label="end" value={spec.end} onChange={value => dispatch(scenarioActions.specChanged({end: Number(value) || 0}))} />
                        <NumberInput size="xs" label="steps" min={2} value={spec.steps} onChange={value => dispatch(scenarioActions.specChanged({steps: Number(value) || 2}))} />
                    </Group>
                )}
                {spec.form === "explicit" && <TextInput size="xs" mt={6} label="values" value={spec.explicit.join(", ")} onChange={event => dispatch(scenarioActions.specChanged({explicit: numbers(event.currentTarget.value)}))} />}

                <Select
                    size="xs"
                    mt={6}
                    label="plot"
                    description="one result kind, shaped into a series"
                    data={OPTION_RESULT_KINDS.filter(choice => choice.availability === "supported").map(choice => ({
                        value: String(choice.value),
                        label: choice.label
                    }))}
                    value={String(spec.plot)}
                    onChange={value => value && dispatch(scenarioActions.specChanged({plot: Number(value) as ResultKind}))}
                />

                <Tooltip label="A sweep is a question, not an edit. Leave this off and the quote is put back where it was." multiline w={260}>
                    <Checkbox size="xs" mt={8} label="keep the last swept value" checked={spec.keepFinalValue} onChange={event => dispatch(scenarioActions.specChanged({keepFinalValue: event.currentTarget.checked}))} />
                </Tooltip>

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
                                    {outcome.seriesName} against {outcome.quoteId}
                                </Text>
                                <Badge size="xs" variant="light" color="gray">
                                    {outcome.points.length} points
                                </Badge>
                                {outcome.y.some(value => value === null) && (
                                    <Tooltip label="A gap is a point this engine published nothing for — not a zero." multiline w={240}>
                                        <Badge size="xs" variant="light" color="orange">
                                            gaps
                                        </Badge>
                                    </Tooltip>
                                )}
                            </Group>
                            <Text fz="xs" c="dimmed">
                                {sweptQuote && `live: ${formatQuote(sweptQuote.value, sweptQuote.unit)}`} · click a point to write it to the market
                            </Text>
                        </Group>
                        <div style={{flex: 1, minHeight: 0}}>
                            <LadderChart
                                x={outcome.x}
                                y={outcome.y}
                                label={outcome.seriesName}
                                xLabel={outcome.quoteId}
                                {...(sweptQuote ? {marker: sweptQuote.value} : {})}
                                onPick={value => void dispatch(bumpQuote(outcome.quoteId, value))}
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
}

function numbers(text: string): number[] {
    return text
        .split(/[,\s]+/)
        .map(part => Number(part))
        .filter(value => Number.isFinite(value));
}

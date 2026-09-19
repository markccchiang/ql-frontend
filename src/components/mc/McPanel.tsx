import {useMemo} from "react";
import {Alert, Badge, Button, Group, Progress, Text, Tooltip} from "@mantine/core";

import {cancelRequest} from "@/session/ops";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {selectLatestMonteCarlo} from "@/store/selectors";
import {uiActions} from "@/store/uiSlice";

import {LadderChart} from "../scenario/LadderChart";

/** What a batched Monte Carlo is doing, and whether it has settled.
 *
 *  The trace is the point: a single number cannot say whether an estimate has
 *  converged or is still wandering. Progress frames carry the running NPV and
 *  nothing else — the standard error only arrives with the terminal frame —
 *  so the band is drawn at the end rather than along the way.
 */
export const McPanel = () => {
    const dispatch = useAppDispatch();
    const run = useAppSelector(selectLatestMonteCarlo);
    // Memoised because LadderChart rebuilds on a new `lines` identity, and this
    // panel re-renders on every progress frame.
    const traceX = useMemo(() => run?.trace.map(point => point.completed) ?? [], [run]);
    const traceLines = useMemo(() => [{label: "running NPV", y: run?.trace.map(point => point.npv) ?? []}], [run]);
    const latest = useAppSelector(state => state.results.latest);

    const isRunning = run?.status === "in-flight" || run?.status === "stalled";
    const completed = run?.progress ? Number(run.progress.completed) : 0;
    const total = run?.progress ? Number(run.progress.total) : 0;

    const standardError = latest?.standardError ?? null;
    const band = standardError !== null ? 1.96 * standardError : null;

    return (
        <div style={{display: "flex", gap: 12, height: "100%"}}>
            <div style={{width: 260, overflowY: "auto", flexShrink: 0}}>
                <Group justify="space-between" mb={6}>
                    <Text fw={600} fz="sm">
                        Monte Carlo
                    </Text>
                    <Group gap={4}>
                        {isRunning && run && (
                            <Button size="compact-xs" color="orange" variant="light" onClick={() => void dispatch(cancelRequest(run.id))}>
                                Cancel
                            </Button>
                        )}
                        <Button size="compact-xs" variant="subtle" onClick={() => dispatch(uiActions.bottomPanelSet(null))}>
                            Hide
                        </Button>
                    </Group>
                </Group>

                {run ? (
                    <>
                        <Group gap={6} mb={4}>
                            <Badge size="xs" variant="light" color={run.status === "ok" ? "teal" : run.status === "error" ? "red" : "yellow"}>
                                {run.status}
                            </Badge>
                            <Text fz="xs" c="dimmed" ff="monospace">
                                #{run.id}
                            </Text>
                        </Group>
                        {total > 0 && (
                            <>
                                <Progress value={(completed / total) * 100} size="sm" />
                                <Text fz="xs" c="dimmed" mt={2}>
                                    {completed.toLocaleString()} of {total.toLocaleString()} paths
                                </Text>
                            </>
                        )}
                        {run.progress?.runningNpv != null && (
                            <Text fz="xs" ff="monospace" mt={4}>
                                running NPV {run.progress.runningNpv.toFixed(6)}
                            </Text>
                        )}
                        {run.elapsedMs !== null && (
                            <Text fz="xs" c="dimmed" mt={2}>
                                {run.elapsedMs} ms round trip
                            </Text>
                        )}
                        {run.error && (
                            <Alert color="red" p="xs" mt={6}>
                                <Text fz="xs">{run.error}</Text>
                            </Alert>
                        )}

                        {run.status === "ok" && latest && (
                            <div style={{marginTop: 8}}>
                                <Text fz="xs" c="dimmed">
                                    final
                                </Text>
                                <Text fz="lg" fw={700} ff="monospace" lh={1.2}>
                                    {latest.npv.toFixed(6)}
                                </Text>
                                {band !== null ? (
                                    <Tooltip label="Independent batches, so the batch errors add in quadrature." multiline w={240}>
                                        <Text fz="xs" c="dimmed">
                                            ± {band.toFixed(6)} at 95% over {latest.samples} paths
                                        </Text>
                                    </Tooltip>
                                ) : (
                                    <Text fz="xs" c="dimmed">
                                        no error estimate published
                                    </Text>
                                )}
                                <Text fz={10} c="dimmed" mt={4}>
                                    engine · {latest.engine}
                                </Text>
                            </div>
                        )}
                    </>
                ) : (
                    <Text fz="xs" c="dimmed">
                        No batched run yet. Set the progress interval on a Monte Carlo engine and price.
                    </Text>
                )}
            </div>

            <div style={{flex: 1, minWidth: 0, display: "flex", flexDirection: "column"}}>
                {run && run.trace.length > 1 ? (
                    <>
                        <Text fz="xs" fw={600} mb={2}>
                            running NPV against paths
                        </Text>
                        <div style={{flex: 1, minHeight: 0}}>
                            <LadderChart x={traceX} lines={traceLines} xLabel="paths" />
                        </div>
                    </>
                ) : (
                    <Group h="100%" justify="center">
                        <Text fz="xs" c="dimmed">
                            The convergence trace appears once the first batch reports.
                        </Text>
                    </Group>
                )}
            </div>
        </div>
    );
};

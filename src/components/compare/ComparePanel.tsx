import {useState} from "react";
import {Alert, Badge, Button, Group, Stack, Text, TextInput} from "@mantine/core";

import {runComparison} from "@/session/compare";
import {compareActions} from "@/store/compareSlice";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {uiActions} from "@/store/uiSlice";

/** The same trade, priced in two sessions at once.
 *
 *  One socket can hold several sessions, which is the one thing the gateway
 *  offers that nothing else here uses. The variant is opened, priced and
 *  closed without disturbing the session in front of the user: a what-if
 *  should not cost you the market you were looking at.
 */
export const ComparePanel = () => {
    const dispatch = useAppDispatch();
    const compare = useAppSelector(state => state.compare);
    const workbook = useAppSelector(state => state.workbook);
    const isLive = useAppSelector(state => state.session.status === "live");
    const [isBusy, setBusy] = useState(false);

    const outcome = compare.outcome;
    const difference = outcome ? outcome.variantNpv - outcome.baseNpv : null;

    return (
        <div style={{display: "flex", gap: 12, height: "100%"}}>
            <div style={{width: 300, overflowY: "auto", flexShrink: 0}}>
                <Group justify="space-between" mb={6}>
                    <Text fw={600} fz="sm">
                        Compare
                    </Text>
                    <Group gap={4}>
                        <Button
                            size="compact-xs"
                            disabled={!isLive || compare.isRunning}
                            loading={isBusy}
                            onClick={() => {
                                setBusy(true);
                                void dispatch(runComparison())
                                    .catch(() => undefined)
                                    .finally(() => setBusy(false));
                            }}
                        >
                            Run
                        </Button>
                        <Button size="compact-xs" variant="subtle" onClick={() => dispatch(uiActions.bottomPanelSet(null))}>
                            Hide
                        </Button>
                    </Group>
                </Group>

                <TextInput
                    size="xs"
                    label="variant evaluation date"
                    description={`base is ${workbook.evaluationDate}`}
                    placeholder={workbook.evaluationDate}
                    value={compare.evaluationDate}
                    onChange={event => dispatch(compareActions.variantChanged({evaluationDate: event.currentTarget.value}))}
                />
                <TextInput
                    size="xs"
                    mt={6}
                    label="variant quotes"
                    description="id=value, comma separated"
                    placeholder="S=110, V=0.25"
                    value={compare.overrides}
                    onChange={event => dispatch(compareActions.variantChanged({overrides: event.currentTarget.value}))}
                />

                <Text fz={10} c="dimmed" mt={6}>
                    The variant runs in its own session on the same socket, then closes. Nothing here touches the session you are working in.
                </Text>

                {compare.error && (
                    <Alert color="red" p="xs" mt={8}>
                        <Text fz="xs">{compare.error}</Text>
                    </Alert>
                )}
            </div>

            <div style={{flex: 1, minWidth: 0, overflowY: "auto"}}>
                {outcome ? (
                    <Stack gap={4}>
                        <Group gap={8}>
                            <Text fz="xs" fw={600}>
                                {outcome.label}
                            </Text>
                            <Badge size="xs" variant="light" color="gray">
                                {outcome.baseSessionId} vs {outcome.variantSessionId}
                            </Badge>
                        </Group>
                        <Group gap="xl" mt={4} align="flex-start">
                            <div>
                                <Text fz="xs" c="dimmed">
                                    base
                                </Text>
                                <Text fz={22} fw={700} ff="monospace" lh={1.2}>
                                    {outcome.baseNpv.toFixed(6)}
                                </Text>
                            </div>
                            <div>
                                <Text fz="xs" c="dimmed">
                                    variant
                                </Text>
                                <Text fz={22} fw={700} ff="monospace" lh={1.2}>
                                    {outcome.variantNpv.toFixed(6)}
                                </Text>
                            </div>
                            <div>
                                <Text fz="xs" c="dimmed">
                                    difference
                                </Text>
                                <Text fz={22} fw={700} ff="monospace" lh={1.2} c={difference === 0 ? "dimmed" : difference! > 0 ? "teal" : "red"}>
                                    {difference! > 0 ? "+" : ""}
                                    {difference!.toFixed(6)}
                                </Text>
                            </div>
                        </Group>
                    </Stack>
                ) : (
                    <Group h="100%" justify="center">
                        <Text fz="xs" c="dimmed">
                            No comparison yet. Change the evaluation date or a quote, and the same trade is priced in a second session.
                        </Text>
                    </Group>
                )}
            </div>
        </div>
    );
};

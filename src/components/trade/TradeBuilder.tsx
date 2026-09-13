import {useCallback, useState} from "react";
import {Alert, Badge, Button, Checkbox, Grid, Group, MultiSelect, Paper, Text, Tooltip} from "@mantine/core";

import type {ResultKind} from "@/gen/quantlib/v2/results_pb";
import {INSTRUMENTS, optionResultKinds, swapResultKinds} from "@/protocol/capabilities";
import {WireError} from "@/protocol/errors";
import {priceCurrentTrade} from "@/session/ops";
import {bookActions} from "@/store/bookSlice";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {selectLegKinds, selectTradeIssues} from "@/store/selectors";
import {uiActions} from "@/store/uiSlice";
import {workbookActions} from "@/store/workbookSlice";

import {ChoiceSelect} from "./ChoiceSelect";
import {EngineCard} from "./EngineCard";
import {ExerciseCard} from "./ExerciseCard";
import {ImpliedVolatilityCard} from "./ImpliedVolatilityCard";
import {PayoffCard} from "./PayoffCard";
import {QuantoCard} from "./QuantoCard";
import {StyleCard} from "./StyleCard";
import {SwapCard} from "./SwapCard";
import {UnderlyingCard} from "./UnderlyingCard";

/** An option is payoff x exercise x underlying x style.
 *
 *  Four adjacent cards rather than one scrolling form: the schema's shape was
 *  taken from QuantLib's own decomposition, and it is the best information
 *  architecture available for the thing being built.
 */
export const TradeBuilder = () => {
    const dispatch = useAppDispatch();
    const issues = useAppSelector(selectTradeIssues);
    const trade = useAppSelector(state => state.workbook.trade);
    const isLive = useAppSelector(state => state.session.status === "live");
    const instrument = useAppSelector(state => state.workbook.trade.instrument?.kind.case ?? "option");
    const legKinds = useAppSelector(selectLegKinds);
    const isQuanto = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" && kind.value.quanto !== undefined;
    });
    const rejection = useAppSelector(state => state.ui.rejection);
    const [isBusy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const errors = issues.filter(issue => issue.severity === "error");

    const price = useCallback(async () => {
        setBusy(true);
        setFailure(null);
        try {
            await dispatch(priceCurrentTrade());
        } catch (error) {
            setFailure(error instanceof WireError ? error.message : error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }, [dispatch]);

    return (
        <Paper mt="xs">
            <Group justify="space-between" mb="xs">
                <Group gap={8}>
                    <Text fw={600} fz="sm">
                        Trade
                    </Text>
                    {errors.length > 0 && (
                        <Badge size="xs" color="red" variant="light">
                            {errors.length} required field{errors.length > 1 ? "s" : ""}
                        </Badge>
                    )}
                </Group>
                <Group gap={4}>
                    <Tooltip label="Set this trade aside. A book prices in one frame, off one graph." multiline w={240}>
                        <Button
                            size="compact-sm"
                            variant="default"
                            onClick={() => {
                                dispatch(workbookActions.bookAdded());
                                dispatch(bookActions.cleared());
                                dispatch(uiActions.bottomPanelShown("book"));
                            }}
                        >
                            Add to Book
                        </Button>
                    </Tooltip>
                    <Button size="compact-sm" loading={isBusy} disabled={!isLive || errors.length > 0} onClick={() => void price()}>
                        Price
                    </Button>
                </Group>
            </Group>

            {/* The rejection that named no field: the maths failed, and there is
          nothing to highlight. */}
            {rejection && !rejection.fieldPath && (
                <Alert color="red" p="xs" mb="xs" title={rejection.code}>
                    <Text fz="xs">{rejection.message}</Text>
                    <Text fz="xs" c="dimmed">
                        {rejection.remedy}
                    </Text>
                </Alert>
            )}
            {rejection?.fieldPath && (
                <Alert color={rejection.errorClass === "unsupported" ? "orange" : "red"} p="xs" mb="xs" title={rejection.code}>
                    <Text fz="xs">{rejection.message}</Text>
                    <Text fz="xs" c="dimmed" ff="monospace">
                        {rejection.fieldPath}
                    </Text>
                </Alert>
            )}

            <Paper mb="xs">
                <ChoiceSelect label="instrument" choices={INSTRUMENTS} value={instrument} onChange={next => dispatch(workbookActions.instrumentKindSet(next as "option" | "swap"))} />
            </Paper>

            {instrument === "swap" ? (
                <Grid gutter="xs">
                    <Grid.Col span={7}>
                        <SwapCard />
                    </Grid.Col>
                    <Grid.Col span={5}>
                        <EngineCard />
                        <Paper mt="xs">
                            <MultiSelect
                                size="xs"
                                label="results"
                                description="leg NPV and BPS come back one key per leg"
                                data={swapResultKinds(legKinds).map(choice => ({value: String(choice.value), label: choice.label, disabled: choice.availability !== "supported"}))}
                                value={trade.results.map(String)}
                                onChange={values => dispatch(workbookActions.resultKindsSet(values.map(Number) as ResultKind[]))}
                            />
                        </Paper>
                    </Grid.Col>
                </Grid>
            ) : (
                <Grid gutter="xs">
                    <Grid.Col span={6}>
                        <PayoffCard />
                    </Grid.Col>
                    <Grid.Col span={6}>
                        <ExerciseCard />
                    </Grid.Col>
                    <Grid.Col span={6}>
                        <UnderlyingCard />
                    </Grid.Col>
                    <Grid.Col span={6}>
                        <EngineCard />
                    </Grid.Col>
                    <Grid.Col span={6}>
                        <StyleCard />
                    </Grid.Col>
                    <Grid.Col span={6}>
                        <QuantoCard />
                    </Grid.Col>
                    <Grid.Col span={12}>
                        <ImpliedVolatilityCard />
                    </Grid.Col>
                    <Grid.Col span={12}>
                        <Paper>
                            <Group gap="xs" align="flex-start" grow>
                                <MultiSelect
                                    size="xs"
                                    label="results"
                                    description="an engine that cannot supply one is a named rejection, not a missing key"
                                    data={optionResultKinds(isQuanto).map(choice => ({value: String(choice.value), label: choice.label, disabled: choice.availability !== "supported"}))}
                                    value={trade.results.map(String)}
                                    onChange={values => dispatch(workbookActions.resultKindsSet(values.map(Number) as ResultKind[]))}
                                />
                            </Group>
                            <Checkbox
                                size="xs"
                                mt="xs"
                                label="include the engine's own additional results"
                                checked={trade.includeAdditionalResults}
                                onChange={event => dispatch(workbookActions.includeAdditionalResultsSet(event.currentTarget.checked))}
                            />
                        </Paper>
                    </Grid.Col>
                </Grid>
            )}

            {failure && (
                <Alert color="red" mt="xs" p="xs">
                    {failure}
                </Alert>
            )}
        </Paper>
    );
};

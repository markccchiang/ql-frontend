import {ActionIcon, Badge, Group, Menu, Paper, ScrollArea, Stack, Text, TextInput, Tooltip, UnstyledButton} from "@mantine/core";

import {formatQuote} from "@/lib/units";
import {asQuote, KIND_LABEL} from "@/market/model";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {selectIssues} from "@/store/selectors";
import {workbookActions} from "@/store/workbookSlice";

import {MarketObjectEditor} from "./MarketObjectEditor";

export const MarketPane = () => {
    const dispatch = useAppDispatch();
    const {market, evaluationDate, selectedId} = useAppSelector(s => s.workbook);
    const builtIds = useAppSelector(s => s.session.marketIds);
    const isSessionLive = useAppSelector(s => s.session.status === "live");
    const issues = useAppSelector(selectIssues);

    const built = new Set(builtIds);
    const selected = market.find(object => object.id === selectedId) ?? null;

    return (
        <Paper h="100%" style={{display: "flex", flexDirection: "column", minHeight: 0}}>
            <Group justify="space-between" mb="xs" wrap="nowrap">
                <Text fw={600} fz="sm">
                    Market
                </Text>
                <Menu position="bottom-end">
                    <Menu.Target>
                        <ActionIcon size="sm" variant="default" aria-label="add market object">
                            +
                        </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Label>add</Menu.Label>
                        <Menu.Item onClick={() => dispatch(workbookActions.objectAdded("quote"))}>quote</Menu.Item>
                        <Menu.Item onClick={() => dispatch(workbookActions.objectAdded("flatCurve"))}>flat yield curve</Menu.Item>
                        <Menu.Item onClick={() => dispatch(workbookActions.objectAdded("bootstrapCurve"))}>bootstrapped yield curve</Menu.Item>
                        <Menu.Item onClick={() => dispatch(workbookActions.objectAdded("volatility"))}>constant volatility</Menu.Item>
                        <Menu.Item onClick={() => dispatch(workbookActions.objectAdded("index"))}>index</Menu.Item>
                        <Menu.Item onClick={() => dispatch(workbookActions.objectAdded("fixings"))}>fixings</Menu.Item>
                        <Menu.Item onClick={() => dispatch(workbookActions.objectAdded("correlation"))}>correlation matrix</Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </Group>

            <Tooltip label="Everything in the session prices against this date. Changing it is a new session.">
                <TextInput size="xs" label="evaluation date" value={evaluationDate} mb="xs" onChange={event => dispatch(workbookActions.evaluationDateSet(event.currentTarget.value))} />
            </Tooltip>

            <ScrollArea style={{flex: 1, minHeight: 60}} type="auto">
                <Stack gap={2}>
                    {market.map(object => {
                        const objectIssues = issues.filter(issue => issue.objectId === object.id);
                        const errors = objectIssues.filter(issue => issue.severity === "error");
                        const quote = asQuote(object);
                        const isSelected = object.id === selectedId;
                        // The row selects; the × removes. Siblings rather than one
                        // inside the other, so each is a control of its own from
                        // the keyboard and to a screen reader.
                        return (
                            <Group
                                key={object.id}
                                gap={2}
                                wrap="nowrap"
                                pr={4}
                                style={{
                                    borderRadius: 4,
                                    background: isSelected ? "var(--mantine-color-dark-4)" : "var(--mantine-color-dark-6)",
                                    borderLeft: `2px solid ${errors.length ? "var(--mantine-color-red-6)" : "transparent"}`
                                }}
                            >
                                <UnstyledButton aria-pressed={isSelected} onClick={() => dispatch(workbookActions.selected(isSelected ? null : object.id))} px={6} py={3} style={{flex: 1, minWidth: 0}}>
                                    <Group justify="space-between" wrap="nowrap">
                                        <Group gap={6} wrap="nowrap" style={{minWidth: 0}}>
                                            <Text fz="xs" ff="monospace" fw={700}>
                                                {object.id}
                                            </Text>
                                            <Text fz="xs" c="dimmed" truncate>
                                                {KIND_LABEL[object.kind.case ?? ""] ?? object.kind.case}
                                            </Text>
                                        </Group>
                                        <Group gap={6} wrap="nowrap">
                                            {quote && (
                                                <Text fz="xs" ff="monospace">
                                                    {formatQuote(quote.value, quote.unit)}
                                                </Text>
                                            )}
                                            {errors.length > 0 && (
                                                <Tooltip label={errors[0]!.message} multiline w={240}>
                                                    <Badge size="xs" color="red" variant="light">
                                                        {errors.length}
                                                    </Badge>
                                                </Tooltip>
                                            )}
                                            {isSessionLive && !built.has(object.id) && (
                                                <Tooltip label="Not in SessionOpened.market_ids — rebuild to include it">
                                                    <Badge size="xs" color="yellow" variant="light">
                                                        not built
                                                    </Badge>
                                                </Tooltip>
                                            )}
                                        </Group>
                                    </Group>
                                </UnstyledButton>
                                <ActionIcon size="xs" variant="subtle" color="gray" aria-label={`remove ${object.id}`} onClick={() => dispatch(workbookActions.objectRemoved(object.id))}>
                                    ×
                                </ActionIcon>
                            </Group>
                        );
                    })}
                </Stack>
            </ScrollArea>

            {selected && (
                <div style={{marginTop: 8}}>
                    <MarketObjectEditor object={selected} />
                </div>
            )}
        </Paper>
    );
};

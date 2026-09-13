import {Badge, Button, Checkbox, Group, ScrollArea, Table, Text, Tooltip} from "@mantine/core";

import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {uiActions} from "@/store/uiSlice";
import {workbookActions} from "@/store/workbookSlice";

/** The working behind a swap's NPV.
 *
 *  The sum of the present-value column is the NPV — that is the property that
 *  makes the table worth showing rather than decorating, and it holds because
 *  each row's discount is the one the engine used rather than one this client
 *  recomputed.
 */
export const CashFlowPanel = () => {
    const dispatch = useAppDispatch();
    const latest = useAppSelector(state => state.results.latest);
    const isSwap = useAppSelector(state => state.workbook.trade.instrument?.kind.case === "swap");
    const isAsked = useAppSelector(state => state.workbook.trade.includeCashflows);

    const rows = latest?.cashflows ?? [];
    const legs = [...new Set(rows.map(row => row.leg))].sort((a, b) => a - b);

    return (
        <div style={{display: "flex", gap: 12, height: "100%"}}>
            <div style={{width: 260, flexShrink: 0}}>
                <Group justify="space-between" mb={6}>
                    <Text fw={600} fz="sm">
                        Cash flows
                    </Text>
                    <Button size="compact-xs" variant="subtle" onClick={() => dispatch(uiActions.bottomPanelSet(null))}>
                        Hide
                    </Button>
                </Group>

                <Checkbox size="xs" label="ask for the table with the price" disabled={!isSwap} checked={isAsked} onChange={event => dispatch(workbookActions.includeCashflowsSet(event.currentTarget.checked))} />
                {!isSwap && (
                    <Text fz={10} c="dimmed" mt={4}>
                        Cash-flow instruments only. An option has no coupons, and the service refuses the request rather than answering with an empty table.
                    </Text>
                )}

                {rows.length > 0 && (
                    <Text fz="xs" c="dimmed" mt={8}>
                        {rows.length} rows over {legs.length} legs. Paid flows are left out.
                    </Text>
                )}
            </div>

            <div style={{flex: 1, minWidth: 0}}>
                {rows.length > 0 ? (
                    <ScrollArea h="100%" type="auto">
                        <Table stickyHeader withRowBorders={false}>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>leg</Table.Th>
                                    <Table.Th>payment</Table.Th>
                                    <Table.Th ta="right">notional</Table.Th>
                                    <Table.Th ta="right">rate</Table.Th>
                                    <Table.Th>fixing</Table.Th>
                                    <Table.Th ta="right">amount</Table.Th>
                                    <Table.Th ta="right">discount</Table.Th>
                                    <Table.Th ta="right">present value</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {rows.map((row, at) => (
                                    <Table.Tr key={at}>
                                        <Table.Td>{row.leg}</Table.Td>
                                        <Table.Td ff="monospace">{row.paymentDate}</Table.Td>
                                        <Table.Td ta="right" ff="monospace">
                                            {row.notional ? row.notional.toLocaleString() : ""}
                                        </Table.Td>
                                        <Table.Td ta="right" ff="monospace">
                                            {row.rate ? `${(row.rate * 100).toFixed(4)} %` : ""}
                                        </Table.Td>
                                        <Table.Td ff="monospace">
                                            {row.fixingDate && (
                                                <Tooltip label={row.isPastFixing ? "from IndexManager: this fixing has happened" : "forecast off the index's curve"}>
                                                    <Badge size="xs" variant="light" color={row.isPastFixing ? "teal" : "gray"}>
                                                        {row.fixingDate}
                                                    </Badge>
                                                </Tooltip>
                                            )}
                                        </Table.Td>
                                        <Table.Td ta="right" ff="monospace">
                                            {row.amount.toFixed(2)}
                                        </Table.Td>
                                        <Table.Td ta="right" ff="monospace">
                                            {row.discount.toFixed(6)}
                                        </Table.Td>
                                        <Table.Td ta="right" ff="monospace">
                                            {row.presentValue.toFixed(2)}
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                ) : (
                    <Group h="100%" justify="center">
                        <Text fz="xs" c="dimmed">
                            No table yet. Tick the box on a swap and price; the rows come back with the NPV they add up to.
                        </Text>
                    </Group>
                )}
            </div>
        </div>
    );
};

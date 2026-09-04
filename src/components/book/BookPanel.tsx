import {useCallback, useState} from "react";
import {Alert, Badge, Button, Group, Paper, Progress, ScrollArea, Table, Text, Tooltip} from "@mantine/core";

import {cancelBook, priceBook} from "@/session/book";
import {bookActions} from "@/store/bookSlice";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {uiActions} from "@/store/uiSlice";
import {workbookActions} from "@/store/workbookSlice";
import {describeTrade} from "@/trade/describe";

/** The book.
 *
 *  Several trades against one market, priced in one frame. They share this
 *  workbook's market by construction, which is what makes them a book rather
 *  than several tabs, and it is why the total below is a total rather than a
 *  coincidence.
 *
 *  A trade that cannot price costs its own row. The service answers each entry
 *  with either a price or the rejection it would have been sent on its own, so
 *  the complaint lands on the row it belongs to and the rest of the book keeps
 *  its numbers.
 */
export const BookPanel = () => {
    const dispatch = useAppDispatch();
    const book = useAppSelector(state => state.workbook.book);
    const {outcome, runningRequestId, error} = useAppSelector(state => state.book);
    const isLive = useAppSelector(state => state.session.status === "live");
    const progress = useAppSelector(state => (runningRequestId ? (state.requests.byId[runningRequestId]?.progress ?? null) : null));
    const [isBusy, setBusy] = useState(false);

    const run = useCallback(async () => {
        setBusy(true);
        try {
            await dispatch(priceBook());
        } catch {
            // Recorded on the slice and shown below.
        } finally {
            setBusy(false);
        }
    }, [dispatch]);

    const completed = progress ? Number(progress.completed) : 0;
    const total = progress ? Number(progress.total) : 0;

    // Summed per currency, because adding two currencies would be arithmetic
    // rather than a number anyone can use.
    const totals = new Map<string, number>();
    for (const row of outcome?.rows ?? []) {
        if (row.npv === null) continue;
        totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.npv);
    }
    const isStale = outcome !== null && outcome.rows.length !== book.length;

    return (
        <Paper p="xs" radius={0} style={{border: 0, height: "100%", display: "flex", flexDirection: "column", gap: 6, padding: 0}}>
            <Group justify="space-between">
                <Group gap={8}>
                    <Text fw={600} fz="sm">
                        Book
                    </Text>
                    <Badge size="xs" variant="light" color="gray">
                        {book.length} {book.length === 1 ? "trade" : "trades"}, one request
                    </Badge>
                    {[...totals].map(([currency, value]) => (
                        <Badge key={currency} size="xs" variant="light">
                            {currency || "total"} {value.toFixed(6)}
                        </Badge>
                    ))}
                    {outcome && outcome.abandonedAfter > 0 && (
                        <Tooltip label="A failure left the graph partly invalidated, so the rest was not priced against it." multiline w={260}>
                            <Badge size="xs" variant="light" color="orange">
                                abandoned after {outcome.abandonedAfter}
                            </Badge>
                        </Tooltip>
                    )}
                    {isStale && (
                        <Badge size="xs" variant="light" color="orange">
                            book edited since
                        </Badge>
                    )}
                </Group>
                <Group gap={4}>
                    {runningRequestId && (
                        <Button size="compact-xs" color="orange" variant="light" onClick={() => void dispatch(cancelBook())}>
                            cancel
                        </Button>
                    )}
                    <Button size="compact-xs" disabled={!isLive || book.length === 0 || !!runningRequestId} loading={isBusy} onClick={() => void run()}>
                        price the book
                    </Button>
                    <Button
                        size="compact-xs"
                        variant="default"
                        disabled={book.length === 0}
                        onClick={() => {
                            dispatch(workbookActions.bookCleared());
                            dispatch(bookActions.cleared());
                        }}
                    >
                        empty
                    </Button>
                    <Button size="compact-xs" variant="subtle" onClick={() => dispatch(uiActions.bottomPanelSet(null))}>
                        hide
                    </Button>
                </Group>
            </Group>

            {progress && total > 0 && (
                <div>
                    <Progress value={(completed / total) * 100} size="sm" />
                    <Text fz="xs" c="dimmed" mt={2}>
                        trade {completed} of {total}
                    </Text>
                </div>
            )}

            {error && (
                <Alert color="red" p="xs">
                    <Text fz="xs">{error}</Text>
                </Alert>
            )}

            {book.length === 0 ? (
                <Group h="100%" justify="center">
                    <Text fz="xs" c="dimmed">
                        No trades set aside. Build one and press “add to book”: the whole book prices in one frame, off one graph.
                    </Text>
                </Group>
            ) : (
                <ScrollArea style={{flex: 1, minHeight: 0}}>
                    <Table fz="xs" striped withRowBorders={false} highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th w={40}>#</Table.Th>
                                <Table.Th>trade</Table.Th>
                                <Table.Th ta="right">NPV</Table.Th>
                                <Table.Th>engine, as it ran</Table.Th>
                                <Table.Th w={130} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {book.map((trade, at) => {
                                const row = outcome?.rows[at];
                                return (
                                    <Table.Tr key={at}>
                                        <Table.Td c="dimmed">{at + 1}</Table.Td>
                                        <Table.Td>{describeTrade(trade)}</Table.Td>
                                        <Table.Td ta="right" ff="monospace">
                                            {row?.npv !== null && row?.npv !== undefined ? (
                                                row.npv.toFixed(6)
                                            ) : row?.error ? (
                                                <Text component="span" fz="xs" c="red">
                                                    {row.error}
                                                    {row.fieldPath ? ` (${row.fieldPath})` : ""}
                                                </Text>
                                            ) : (
                                                <Text component="span" fz="xs" c="dimmed">
                                                    not priced
                                                </Text>
                                            )}
                                        </Table.Td>
                                        <Table.Td c="dimmed">{row?.engine ?? ""}</Table.Td>
                                        <Table.Td>
                                            <Group gap={4} justify="flex-end">
                                                <Tooltip label="Put this trade back in the builder, where it can be changed and priced on its own.">
                                                    <Button
                                                        size="compact-xs"
                                                        variant="subtle"
                                                        onClick={() => {
                                                            dispatch(workbookActions.bookRecalled(at));
                                                            dispatch(uiActions.bottomPanelSet(null));
                                                        }}
                                                    >
                                                        edit
                                                    </Button>
                                                </Tooltip>
                                                <Button
                                                    size="compact-xs"
                                                    variant="subtle"
                                                    color="gray"
                                                    aria-label={`remove trade ${at + 1}`}
                                                    onClick={() => {
                                                        dispatch(workbookActions.bookRemoved(at));
                                                        dispatch(bookActions.cleared());
                                                    }}
                                                >
                                                    ×
                                                </Button>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            )}
        </Paper>
    );
};

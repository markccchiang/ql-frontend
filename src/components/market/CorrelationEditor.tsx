import {Group, NumberInput, Select, Table, Text, TextInput} from "@mantine/core";

import type {CorrelationMatrix} from "@/gen/quantlib/v2/market_pb";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {selectQuoteIds} from "@/store/selectors";
import {workbookActions} from "@/store/workbookSlice";

/** A correlation matrix as a grid.
 *
 *  Only the upper triangle is editable, and writing a cell writes its mirror:
 *  a correlation matrix is symmetric, so an editor that let the two halves
 *  disagree would be an editor for authoring rejections. The diagonal is not
 *  editable at all — a matrix whose diagonal can be dragged off 1 is not a
 *  correlation matrix.
 *
 *  Each off-diagonal is a `Number`, so it can be a literal or a quote id. A
 *  quote id is what makes a correlation draggable in the quote bar and
 *  sweepable like any other number; the service reads the matrix afresh on
 *  every request, which is the only reason a moved correlation reaches the
 *  price.
 */
export const CorrelationEditor = ({id, matrix, error}: {id: string; matrix: CorrelationMatrix; error?: string}) => {
    const dispatch = useAppDispatch();
    const quotes = useAppSelector(selectQuoteIds);
    const n = matrix.labels.length;

    const entry = (row: number, column: number) => matrix.values[row * n + column];

    return (
        <>
            <TextInput
                size="xs"
                mt="xs"
                label="labels"
                description="comma separated, one per asset — an underlying finds its row by label, not by position"
                value={matrix.labels.join(", ")}
                onChange={event =>
                    dispatch(
                        workbookActions.correlationLabelsSet({
                            id,
                            labels: event.currentTarget.value
                                .split(",")
                                .map(part => part.trim())
                                .filter(Boolean)
                        })
                    )
                }
            />

            <Table mt="xs" withTableBorder withColumnBorders fz="xs" verticalSpacing={2} horizontalSpacing={4} layout="fixed">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th w={28} />
                        {matrix.labels.map(label => (
                            <Table.Th key={label}>{label}</Table.Th>
                        ))}
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {matrix.labels.map((rowLabel, row) => (
                        <Table.Tr key={rowLabel}>
                            <Table.Th>{rowLabel}</Table.Th>
                            {matrix.labels.map((columnLabel, column) => {
                                const value = entry(row, column);
                                const isQuote = value?.source.case === "quoteId";
                                if (row === column) {
                                    return (
                                        <Table.Td key={columnLabel} c="dimmed">
                                            1
                                        </Table.Td>
                                    );
                                }
                                if (column < row) {
                                    return (
                                        <Table.Td key={columnLabel} c="dimmed">
                                            {isQuote ? value.source.value : (value?.source.value ?? 0)}
                                        </Table.Td>
                                    );
                                }
                                return (
                                    <Table.Td key={columnLabel}>
                                        <Group gap={2} wrap="nowrap">
                                            {isQuote ? (
                                                <Select
                                                    size="xs"
                                                    w={92}
                                                    data={quotes}
                                                    placeholder="pick a quote"
                                                    value={typeof value.source.value === "string" ? value.source.value || null : null}
                                                    clearable
                                                    onChange={next => dispatch(workbookActions.correlationEntryQuoteSet({id, row, column, quoteId: next ?? ""}))}
                                                />
                                            ) : (
                                                <NumberInput
                                                    size="xs"
                                                    w={92}
                                                    decimalScale={4}
                                                    step={0.05}
                                                    min={-1}
                                                    max={1}
                                                    value={value?.source.case === "fixed" ? value.source.value : 0}
                                                    onChange={next => dispatch(workbookActions.correlationEntrySet({id, row, column, value: Number(next) || 0}))}
                                                />
                                            )}
                                            <Text
                                                fz={10}
                                                c="dimmed"
                                                style={{cursor: "pointer"}}
                                                onClick={() => (isQuote ? dispatch(workbookActions.correlationEntrySet({id, row, column, value: 0})) : dispatch(workbookActions.correlationEntryLive({id, row, column})))}
                                            >
                                                {isQuote ? "fix" : "live"}
                                            </Text>
                                        </Group>
                                    </Table.Td>
                                );
                            })}
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>

            {error && (
                <Text fz="xs" c="red" mt={4}>
                    {error}
                </Text>
            )}
            <Text fz={10} c="dimmed" mt={4}>
                Symmetric and unit-diagonal by construction. The service also checks that the matrix is positive semi-definite — three pairwise correlations can each be legal and jointly impossible — because StochasticProcessArray would
                silently repair one that is not.
            </Text>
        </>
    );
};

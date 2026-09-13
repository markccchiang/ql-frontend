import {Badge, Button, Code, Group, ScrollArea, Table, Text} from "@mantine/core";

import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {wireActions} from "@/store/wireSlice";

import {pythonSnippet} from "./pythonSnippet";

/** Every frame in both directions, as canonical Protobuf JSON.
 *
 *  Trust infrastructure: a quant who disagrees with a number needs to see the
 *  request that produced it (doc/PLAN.md §5), and copy-as-Python turns any frame
 *  into a runnable repro against the daemon.
 */
export const FrameInspector = () => {
    const dispatch = useAppDispatch();
    const {frames, selected} = useAppSelector(s => s.wire);
    const shown = frames.find(frame => frame.seq === selected) ?? frames[0];

    return (
        <div style={{display: "flex", height: 260, borderTop: "1px solid var(--mantine-color-dark-4)"}}>
            <div style={{width: 380, borderRight: "1px solid var(--mantine-color-dark-4)"}}>
                <Group justify="space-between" px="xs" py={4}>
                    <Text fz="xs" fw={600}>
                        Frames
                    </Text>
                    <Group gap={4}>
                        <Button size="compact-xs" variant="subtle" onClick={() => dispatch(wireActions.cleared())}>
                            clear
                        </Button>
                        <Button size="compact-xs" variant="subtle" onClick={() => dispatch(wireActions.toggled())}>
                            hide
                        </Button>
                    </Group>
                </Group>
                <ScrollArea h={220}>
                    <Table highlightOnHover>
                        <Table.Tbody>
                            {frames.map(frame => (
                                <Table.Tr key={frame.seq} onClick={() => dispatch(wireActions.selected(frame.seq))} style={{cursor: "pointer"}} bg={shown?.seq === frame.seq ? "var(--mantine-color-dark-5)" : undefined}>
                                    <Table.Td w={28}>
                                        <Text fz="xs" c={frame.direction === "out" ? "blue" : "teal"}>
                                            {frame.direction === "out" ? "→" : "←"}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td w={36}>
                                        <Text fz="xs" c="dimmed" ff="monospace">
                                            #{frame.requestId}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text fz="xs" ff="monospace">
                                            {frame.kind}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td w={52} ta="right">
                                        {frame.terminal && (
                                            <Badge size="xs" variant="light" color="gray">
                                                term
                                            </Badge>
                                        )}
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </div>

            <ScrollArea style={{flex: 1}} p="xs">
                {shown ? (
                    <>
                        <Group justify="space-between" mb={4}>
                            <Text fz="xs" c="dimmed">
                                {shown.direction === "out" ? "ClientFrame" : "ServerFrame"} · {new Date(shown.at).toLocaleTimeString()}
                            </Text>
                            <Group gap={4}>
                                <Button size="compact-xs" variant="subtle" onClick={() => void navigator.clipboard.writeText(JSON.stringify(shown.json, null, 2))}>
                                    copy JSON
                                </Button>
                                <Button size="compact-xs" variant="subtle" onClick={() => void navigator.clipboard.writeText(pythonSnippet(shown))}>
                                    copy as Python
                                </Button>
                            </Group>
                        </Group>
                        <Code block fz="xs">
                            {JSON.stringify(shown.json, null, 2)}
                        </Code>
                    </>
                ) : (
                    <Text fz="xs" c="dimmed">
                        Nothing on the wire yet.
                    </Text>
                )}
            </ScrollArea>
        </div>
    );
};

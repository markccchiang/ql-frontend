import {Badge, Button, Code, Group, Indicator, Text} from "@mantine/core";

import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {selectInFlight} from "@/store/requestsSlice";
import {scenarioActions} from "@/store/scenarioSlice";
import {wireActions} from "@/store/wireSlice";

const STATUS_COLOR = {connected: "teal", connecting: "yellow", disconnected: "red"} as const;

export const StatusBar = () => {
    const dispatch = useAppDispatch();
    const connection = useAppSelector(s => s.connection);
    const session = useAppSelector(s => s.session);
    const inFlight = useAppSelector(selectInFlight);
    const frames = useAppSelector(s => s.wire.frames.length);

    return (
        <Group justify="space-between" px="sm" py={6} style={{borderBottom: "1px solid var(--mantine-color-dark-4)"}}>
            <Group gap="xs">
                <Text fw={700} fz="sm">
                    qlservice
                </Text>
                <Indicator color={STATUS_COLOR[connection.status]} size={8} processing={connection.status === "connecting"} ml={4} mr={8} />
                <Code fz="xs">{connection.url}</Code>
                {connection.detail && (
                    <Text fz="xs" c="dimmed">
                        {connection.detail}
                    </Text>
                )}
            </Group>

            <Group gap="xs">
                {session.sessionId ? (
                    <Badge variant="light" color="teal" size="sm">
                        session {session.sessionId}
                    </Badge>
                ) : (
                    <Badge variant="light" color="gray" size="sm">
                        no session
                    </Badge>
                )}
                {session.status === "lost" && (
                    <Badge variant="light" color="red" size="sm">
                        session lost with the socket
                    </Badge>
                )}
                {inFlight.length > 0 && (
                    <Badge variant="light" color="yellow" size="sm">
                        {inFlight.length} in flight
                    </Badge>
                )}
                {connection.lastRoundTripMs !== null && (
                    <Text fz="xs" c="dimmed">
                        {connection.lastRoundTripMs} ms round trip
                    </Text>
                )}
                <Button size="compact-xs" variant="default" onClick={() => dispatch(scenarioActions.toggled())}>
                    sweep
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(wireActions.toggled())}>
                    frames ({frames})
                </Button>
            </Group>
        </Group>
    );
};

import {Badge, Button, Code, Group, Indicator, Text, Tooltip} from "@mantine/core";

import {cancelEverything} from "@/session/ops";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {selectInFlight} from "@/store/requestsSlice";
import {uiActions} from "@/store/uiSlice";
import {wireActions} from "@/store/wireSlice";

const STATUS_COLOR = {connected: "teal", connecting: "yellow", disconnected: "red"} as const;

export const StatusBar = () => {
    const dispatch = useAppDispatch();
    const connection = useAppSelector(s => s.connection);
    const session = useAppSelector(s => s.session);
    const inFlight = useAppSelector(selectInFlight);
    const frames = useAppSelector(s => s.wire.frames.length);
    const capabilities = useAppSelector(s => s.capabilities);

    return (
        <Group justify="space-between" px="sm" py={6} style={{borderBottom: "1px solid var(--mantine-color-dark-4)"}}>
            <Group gap="xs">
                <Text fw={700} fz="sm">
                    qlservice
                </Text>
                <Indicator color={STATUS_COLOR[connection.status]} size={8} processing={connection.status === "connecting"} ml={4} mr={8} />
                <Code fz="xs">{connection.url}</Code>
                {capabilities.reported && (
                    <Tooltip label={`${capabilities.reported.optionStyles.length} option styles, ${capabilities.reported.resultKinds.length} result kinds`}>
                        <Text fz="xs" c="dimmed">
                            {capabilities.reported.build} · QuantLib {capabilities.reported.quantlibVersion}
                        </Text>
                    </Tooltip>
                )}
                {capabilities.drift.length > 0 && (
                    <Tooltip label={capabilities.drift.join("; ")} multiline w={320}>
                        <Badge size="sm" variant="light" color="orange">
                            {capabilities.drift.length} capability mismatch{capabilities.drift.length > 1 ? "es" : ""}
                        </Badge>
                    </Tooltip>
                )}
                {connection.status === "disconnected" && connection.diagnosis && (
                    <Tooltip
                        label={
                            connection.diagnosis === "refused"
                                ? "The service answered a plain HTTP request, so it is running and refused this page's socket. Its allowed origins are the usual cause: start it with --allow-origin for wherever this app is served from."
                                : "Nothing answered on that address at all, over HTTP either. The service is not running, or not where this app is looking."
                        }
                        multiline
                        w={320}
                    >
                        <Badge variant="light" color={connection.diagnosis === "refused" ? "orange" : "red"} size="sm">
                            {connection.diagnosis === "refused" ? "running, but refusing this page" : "nothing answering"}
                        </Badge>
                    </Tooltip>
                )}
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
                    <Tooltip
                        label="Stops what can be stopped and gives the session back either way. A sweep, a book or a batched Monte Carlo stops at its next step and keeps what it has; a calculation already inside an engine cannot be interrupted, so the service lets it go and rebuilds the session behind you."
                        multiline
                        w={320}
                    >
                        <Button size="compact-xs" variant="light" color="yellow" onClick={() => void dispatch(cancelEverything())}>
                            cancel {inFlight.length} in flight
                        </Button>
                    </Tooltip>
                )}
                {connection.lastRoundTripMs !== null && (
                    <Text fz="xs" c="dimmed">
                        {connection.lastRoundTripMs} ms round trip
                    </Text>
                )}
                <Button size="compact-xs" variant="default" onClick={() => dispatch(uiActions.bottomPanelSet("sweep"))}>
                    sweep
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(uiActions.bottomPanelSet("mc"))}>
                    monte carlo
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(uiActions.bottomPanelSet("compare"))}>
                    compare
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(uiActions.bottomPanelSet("curve"))}>
                    curve
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(uiActions.bottomPanelSet("cashflows"))}>
                    cash flows
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(uiActions.bottomPanelSet("book"))}>
                    book
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(wireActions.toggled())}>
                    frames ({frames})
                </Button>
            </Group>
        </Group>
    );
};

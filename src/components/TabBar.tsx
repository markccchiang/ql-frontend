import {ActionIcon, Badge, Group, Tooltip, UnstyledButton} from "@mantine/core";

import {closeTab, openTab, switchTab} from "@/session/tabs";
import {useAppDispatch, useAppSelector} from "@/store/hooks";

/** One socket, several sessions, one at a time in front of you.
 *
 *  The gateway has always allowed several sessions on a connection; this is
 *  what makes it usable. A parked tab keeps its backend session open, so
 *  coming back to it costs nothing and its graph is still warm — which is the
 *  difference between a tab and reopening a workbook.
 */
export const TabBar = () => {
    const dispatch = useAppDispatch();
    const {order, activeId, byId} = useAppSelector(state => state.tabs);
    const activeSession = useAppSelector(state => state.session);

    return (
        <Group gap={4} px="sm" py={4} wrap="nowrap" style={{borderBottom: "1px solid var(--mantine-color-dark-4)", overflowX: "auto"}}>
            <Group role="tablist" aria-label="workbooks" gap={4} wrap="nowrap">
                {order.map(id => {
                    const tab = byId[id];
                    if (!tab) return null;
                    const isActive = id === activeId;
                    const session = isActive ? activeSession : tab.snapshot?.session;
                    const isLive = session?.status === "live";

                    // The tab is the label, and closes on Delete as the
                    // WAI-ARIA tabs pattern has it. The × beside it is the
                    // mouse's way to the same thing, kept out of the tab order
                    // and the accessibility tree: a tablist may own tabs and
                    // nothing else, and a control inside a tab is one a screen
                    // reader cannot reach as its own.
                    return (
                        <Group
                            key={id}
                            role="none"
                            gap={2}
                            wrap="nowrap"
                            pl={8}
                            pr={order.length > 1 ? 2 : 8}
                            py={2}
                            style={{
                                borderRadius: 4,
                                background: isActive ? "var(--mantine-color-dark-5)" : "transparent",
                                border: `1px solid ${isActive ? "var(--mantine-color-dark-3)" : "transparent"}`,
                                flexShrink: 0
                            }}
                        >
                            <Tooltip label={isLive ? `${session?.sessionId} is open on the socket` : "no session on this tab"}>
                                <UnstyledButton
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-keyshortcuts={order.length > 1 ? "Delete" : undefined}
                                    onClick={() => dispatch(switchTab(id))}
                                    onKeyDown={event => {
                                        if (event.key === "Delete" && order.length > 1) {
                                            event.preventDefault();
                                            void dispatch(closeTab(id));
                                        }
                                    }}
                                    style={{display: "flex"}}
                                >
                                    <Badge size="xs" variant="dot" color={isLive ? "teal" : "gray"} styles={{root: {cursor: "pointer"}, label: {fontSize: 11}}}>
                                        {tab.label}
                                    </Badge>
                                </UnstyledButton>
                            </Tooltip>
                            {order.length > 1 && (
                                <ActionIcon size="xs" variant="subtle" color="gray" aria-hidden tabIndex={-1} title={`close ${tab.label}`} onClick={() => void dispatch(closeTab(id))}>
                                    ×
                                </ActionIcon>
                            )}
                        </Group>
                    );
                })}
            </Group>
            <Tooltip label="A second workbook, with its own session on the same socket">
                <ActionIcon size="sm" variant="default" aria-label="new tab" onClick={() => dispatch(openTab())} style={{flexShrink: 0}}>
                    +
                </ActionIcon>
            </Tooltip>
        </Group>
    );
};

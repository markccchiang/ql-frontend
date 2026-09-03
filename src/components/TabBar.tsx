import {ActionIcon, Badge, Group, Tooltip} from "@mantine/core";

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

                    return (
                        <Group
                            key={id}
                            gap={4}
                            wrap="nowrap"
                            px={8}
                            py={2}
                            role="tab"
                            aria-selected={isActive}
                            tabIndex={0}
                            onClick={() => dispatch(switchTab(id))}
                            onKeyDown={event => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    dispatch(switchTab(id));
                                }
                            }}
                            style={{
                                cursor: "pointer",
                                borderRadius: 4,
                                background: isActive ? "var(--mantine-color-dark-5)" : "transparent",
                                border: `1px solid ${isActive ? "var(--mantine-color-dark-3)" : "transparent"}`,
                                flexShrink: 0
                            }}
                        >
                            <Tooltip label={isLive ? `${session?.sessionId} is open on the socket` : "no session on this tab"}>
                                <Badge size="xs" variant="dot" color={isLive ? "teal" : "gray"} styles={{label: {fontSize: 11}}}>
                                    {tab.label}
                                </Badge>
                            </Tooltip>
                            {order.length > 1 && (
                                <ActionIcon
                                    size="xs"
                                    variant="subtle"
                                    color="gray"
                                    aria-label={`close ${tab.label}`}
                                    onClick={event => {
                                        event.stopPropagation();
                                        void dispatch(closeTab(id));
                                    }}
                                >
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

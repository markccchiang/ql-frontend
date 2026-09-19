import {useRef} from "react";
import {Button, Group, Text, TextInput, Tooltip} from "@mantine/core";
import {notifications} from "@mantine/notifications";

import {downloadWorkbook} from "@/store/exportWorkbook";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {clearWorkbook} from "@/store/persistence";
import {decodeWorkbook} from "@/store/workbookCodec";
import {workbookActions} from "@/store/workbookSlice";

/** The document, and the two things you can do with it off this machine.
 *
 *  An exported workbook is canonical Protobuf JSON, so the file is the request
 *  with a label on it: a pricing case can be sent to someone else and reopened
 *  exactly, which is what makes a disagreement about a number settleable.
 */
export const WorkbookBar = () => {
    const dispatch = useAppDispatch();
    // The label only: the rest is read when it is exported, so a dragged quote
    // does not re-render the bar.
    const label = useAppSelector(state => state.workbook.label);
    const fileInput = useRef<HTMLInputElement>(null);

    const importWorkbook = async (file: File) => {
        try {
            dispatch(workbookActions.workbookLoaded(decodeWorkbook(JSON.parse(await file.text()))));
        } catch (error) {
            // Rejected rather than half-applied: see decodeWorkbook.
            notifications.show({color: "red", title: "Not a workbook this build can read", message: error instanceof Error ? error.message : String(error), autoClose: false});
        }
    };

    return (
        <Group gap="xs" px="sm" py={6} wrap="nowrap" style={{borderBottom: "1px solid var(--mantine-color-dark-4)"}}>
            <Text fz="xs" c="dimmed">
                workbook
            </Text>
            <TextInput size="xs" aria-label="workbook label" style={{flex: 1, maxWidth: 320}} value={label} onChange={event => dispatch(workbookActions.labelSet(event.currentTarget.value))} />
            <Tooltip label="Canonical Protobuf JSON: the file is what would go over the wire.">
                <Button size="compact-xs" variant="default" onClick={() => dispatch((_dispatch, getState) => downloadWorkbook(getState().workbook))}>
                    Export
                </Button>
            </Tooltip>
            <Button size="compact-xs" variant="default" onClick={() => fileInput.current?.click()}>
                Import
            </Button>
            <Tooltip label="Forget the saved copy and start from the HANDLERS.md seed.">
                <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => {
                        clearWorkbook();
                        dispatch(workbookActions.reset());
                    }}
                >
                    Reset
                </Button>
            </Tooltip>
            <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                style={{display: "none"}}
                onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void importWorkbook(file);
                    event.currentTarget.value = "";
                }}
            />
        </Group>
    );
};

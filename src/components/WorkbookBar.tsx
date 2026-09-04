import {useRef} from "react";
import {Button, Group, Text, TextInput, Tooltip} from "@mantine/core";

import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {clearWorkbook} from "@/store/persistence";
import {decodeWorkbook, encodeWorkbook} from "@/store/workbookCodec";
import {workbookActions} from "@/store/workbookSlice";

/** The document, and the two things you can do with it off this machine.
 *
 *  An exported workbook is canonical Protobuf JSON, so the file is the request
 *  with a label on it: a pricing case can be sent to someone else and reopened
 *  exactly, which is what makes a disagreement about a number settleable.
 */
export const WorkbookBar = () => {
    const dispatch = useAppDispatch();
    const workbook = useAppSelector(state => state.workbook);
    const fileInput = useRef<HTMLInputElement>(null);

    const exportWorkbook = () => {
        const file = encodeWorkbook({label: workbook.label, evaluationDate: workbook.evaluationDate, market: workbook.market, trade: workbook.trade, book: workbook.book});
        const blob = new Blob([JSON.stringify(file, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${workbook.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "workbook"}.qlwb.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const importWorkbook = async (file: File) => {
        try {
            dispatch(workbookActions.workbookLoaded(decodeWorkbook(JSON.parse(await file.text()))));
        } catch (error) {
            // Rejected rather than half-applied: see decodeWorkbook.
            window.alert(`That is not a workbook this build can read.\n\n${error instanceof Error ? error.message : String(error)}`);
        }
    };

    return (
        <Group gap="xs" px="sm" py={6} wrap="nowrap" style={{borderBottom: "1px solid var(--mantine-color-dark-4)"}}>
            <Text fz="xs" c="dimmed">
                workbook
            </Text>
            <TextInput size="xs" aria-label="workbook label" style={{flex: 1, maxWidth: 320}} value={workbook.label} onChange={event => dispatch(workbookActions.labelSet(event.currentTarget.value))} />
            <Tooltip label="Canonical Protobuf JSON: the file is what would go over the wire.">
                <Button size="compact-xs" variant="default" onClick={exportWorkbook}>
                    export
                </Button>
            </Tooltip>
            <Button size="compact-xs" variant="default" onClick={() => fileInput.current?.click()}>
                import
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
                    reset
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

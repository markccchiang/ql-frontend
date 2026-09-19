import {ActionIcon, Checkbox, Group, NumberInput, Paper, SegmentedControl, Select, Text, Tooltip} from "@mantine/core";

import {formatNumberList, parseNumberList} from "@/lib/parse";
import {axisLength} from "@/session/scenario";
import {useAppDispatch} from "@/store/hooks";
import {type AxisSpec, type PointForm, scenarioActions} from "@/store/scenarioSlice";

import {ParsedTextInput} from "../ParsedText";

/** One axis of the sweep: a quote and the values it takes.
 *
 *  The first axis is the ladder and is drawn along x. A second one becomes a
 *  line per value, which is the honest way to show a grid on a chart a price
 *  can be read off.
 */
export const AxisCard = ({axis, at, quotes, canRemove}: {axis: AxisSpec; at: number; quotes: {id: string; displayName: string}[]; canRemove: boolean}) => {
    const dispatch = useAppDispatch();
    const change = (edit: Partial<AxisSpec>) => dispatch(scenarioActions.axisChanged({at, change: edit}));

    return (
        <Paper p={6} mt={6}>
            <Group justify="space-between" mb={4} wrap="nowrap">
                <Text fz={10} c="dimmed">
                    {at === 0 ? "axis 1 — drawn along x" : `axis ${at + 1} — one line per value`} · {axisLength(axis)} points
                </Text>
                {canRemove && (
                    <Tooltip label="Drop this axis">
                        <ActionIcon size="xs" variant="subtle" color="gray" aria-label={`remove axis ${at + 1}`} onClick={() => dispatch(scenarioActions.axisRemoved(at))}>
                            ×
                        </ActionIcon>
                    </Tooltip>
                )}
            </Group>

            <Select
                size="xs"
                label="quote"
                data={quotes.map(quote => ({value: quote.id, label: quote.displayName ? `${quote.id} — ${quote.displayName}` : quote.id}))}
                value={axis.quoteId}
                onChange={value => value && change({quoteId: value})}
            />

            <Text fz="xs" fw={500} mt={6} mb={2}>
                points
            </Text>
            <SegmentedControl
                size="xs"
                fullWidth
                value={axis.form}
                data={[
                    {value: "relative", label: "relative"},
                    {value: "linear", label: "linear"},
                    {value: "explicit", label: "explicit"}
                ]}
                onChange={value => change({form: value as PointForm})}
            />

            {axis.form === "relative" && (
                <ParsedTextInput size="xs" mt={6} label="factors" description="multipliers of the quote's current value" value={axis.factors} format={formatNumberList} parse={parseNumberList} onValue={factors => change({factors})} />
            )}
            {axis.form === "linear" && (
                <Group gap={6} grow mt={6} align="flex-start">
                    <NumberInput size="xs" label="begin" value={axis.begin} onChange={value => change({begin: Number(value) || 0})} />
                    <NumberInput size="xs" label="end" value={axis.end} onChange={value => change({end: Number(value) || 0})} />
                    <NumberInput size="xs" label="steps" min={2} value={axis.steps} onChange={value => change({steps: Number(value) || 2})} />
                </Group>
            )}
            {axis.form === "explicit" && <ParsedTextInput size="xs" mt={6} label="values" value={axis.explicit} format={formatNumberList} parse={parseNumberList} onValue={explicit => change({explicit})} />}

            <Tooltip label="A sweep is a question, not an edit. Leave this off and the quote is put back where it was." multiline w={260}>
                <Checkbox size="xs" mt={8} label="keep the last swept value" checked={axis.keepFinalValue} onChange={event => change({keepFinalValue: event.currentTarget.checked})} />
            </Tooltip>
        </Paper>
    );
};

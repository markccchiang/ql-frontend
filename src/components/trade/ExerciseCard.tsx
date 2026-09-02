import {Paper, SegmentedControl, Text, Textarea, TextInput} from "@mantine/core";
import {Exercise_Type} from "@/gen/quantlib/v2/instrument_pb";
import {Flag} from "@/gen/quantlib/v2/market_pb";
import {exercisesFor, readsPayoffAtExpiry, type StyleCase} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";
import {ChoiceSelect} from "./ChoiceSelect";
import {useFieldError} from "./useFieldIssue";

const BASE = "instrument.option.exercise";

export function ExerciseCard() {
    const dispatch = useAppDispatch();
    const exercise = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" ? kind.value.exercise : undefined;
    });
    // Selected separately: returning {style, quanto} builds a new object on
    // every call and re-renders the card on every unrelated action.
    const style = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return (kind?.case === "option" ? (kind.value.style.case ?? "vanilla") : "vanilla") as StyleCase;
    });
    const quanto = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" && kind.value.quanto !== undefined;
    });
    const typeError = useFieldError(`${BASE}.type`);
    const datesError = useFieldError(`${BASE}.dates`);
    const flagError = useFieldError(`${BASE}.payoff_at_expiry`);

    if (!exercise) return null;
    const dates = exercise.dates.map(date => (date.form.case === "iso" ? date.form.value : ""));
    const bermudan = exercise.type === Exercise_Type.BERMUDAN;

    return (
        <Paper>
            <Text fw={600} fz="xs" tt="uppercase" c="dimmed" mb={6}>
                exercise
            </Text>

            <ChoiceSelect label="type" choices={exercisesFor(style, quanto)} value={exercise.type} error={typeError} onChange={next => dispatch(workbookActions.exerciseTypeSet(next))} />

            {bermudan ? (
                <Textarea
                    size="xs"
                    mt="xs"
                    label="exercise dates"
                    description="one ISO date per line; the last is the expiry"
                    error={datesError}
                    autosize
                    minRows={3}
                    value={dates.join("\n")}
                    onChange={event =>
                        dispatch(
                            workbookActions.exerciseDatesSet(
                                event.currentTarget.value
                                    .split("\n")
                                    .map(line => line.trim())
                                    .filter(Boolean)
                            )
                        )
                    }
                />
            ) : (
                <TextInput size="xs" mt="xs" label="expiry" placeholder="YYYY-MM-DD" error={datesError} value={dates[0] ?? ""} onChange={event => dispatch(workbookActions.exerciseDatesSet([event.currentTarget.value]))} />
            )}

            {readsPayoffAtExpiry(exercise.type) && (
                <div style={{marginTop: 8}}>
                    <Text fz="xs" fw={500}>
                        payoff at expiry
                    </Text>
                    <Text fz={10} c="dimmed" mb={4}>
                        Settles at expiry rather than on exercise. It changes the price, so it is a Flag with no default.
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        value={exercise.payoffAtExpiry ? String(exercise.payoffAtExpiry) : ""}
                        data={[
                            {value: String(Flag.FALSE), label: "false"},
                            {value: String(Flag.TRUE), label: "true"}
                        ]}
                        onChange={value => dispatch(workbookActions.payoffAtExpirySet(Number(value)))}
                    />
                    {flagError && (
                        <Text fz="xs" c="red" mt={2}>
                            {flagError}
                        </Text>
                    )}
                </div>
            )}
        </Paper>
    );
}

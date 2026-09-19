import {ActionIcon, Group, NumberInput, Paper, SegmentedControl, Select, Text, TextInput} from "@mantine/core";

import {BusinessDayConvention, Frequency} from "@/gen/quantlib/v1/conventions_pb";
import {type Leg, Leg_Kind, Schedule_DateGeneration} from "@/gen/quantlib/v2/instrument_pb";
import {Flag} from "@/gen/quantlib/v2/market_pb";
import {enumOptions} from "@/lib/enums";
import {formatNumberList, parseNumberList} from "@/lib/parse";
import {asQuote} from "@/market/model";
import {LEG_KINDS} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {CalendarControl, DayCounterControl} from "../conventions/ConventionControls";
import {ParsedTextInput} from "../ParsedText";

import {ChoiceSelect} from "./ChoiceSelect";
import {useFieldError} from "./useFieldIssue";

const FREQUENCIES = enumOptions(Frequency);
const CONVENTIONS = enumOptions(BusinessDayConvention);
const DATE_GENERATION = enumOptions(Schedule_DateGeneration);

/** One leg: a schedule, a day counter, notionals, and either a rate or an index.
 *
 *  `pays` is a Flag on every leg and must be set — a two-leg swap with both
 *  legs paying is a portfolio, not a swap, and the backend says so.
 */
export const LegCard = ({at, leg}: {at: number; leg: Leg}) => {
    const dispatch = useAppDispatch();
    const market = useAppSelector(state => state.workbook.market);
    const quotes = market.filter(object => asQuote(object) !== null).map(object => ({value: object.id, label: object.id}));
    const indices = market.filter(object => object.kind.case === "index").map(object => ({value: object.id, label: object.id}));
    const base = `instrument.swap.legs[${at}]`;

    const kindError = useFieldError(`${base}.kind`);
    const paysError = useFieldError(`${base}.pays`);
    const notionalsError = useFieldError(`${base}.notionals`);
    const rateError = useFieldError(`${base}.rate_quote_id`);
    const indexError = useFieldError(`${base}.index_id`);
    const startError = useFieldError(`${base}.schedule.start`);
    const maturityError = useFieldError(`${base}.schedule.maturity`);
    const frequencyError = useFieldError(`${base}.schedule.frequency`);
    const calendarError = useFieldError(`${base}.schedule.calendar`);
    const conventionError = useFieldError(`${base}.schedule.convention`);
    const generationError = useFieldError(`${base}.schedule.date_generation`);
    const eomError = useFieldError(`${base}.schedule.end_of_month`);
    const dayCounterError = useFieldError(`${base}.day_counter`);
    const inArrearsError = useFieldError(`${base}.in_arrears`);

    const schedule = leg.schedule;
    const iso = (field: "start" | "maturity") => (schedule?.[field]?.form.case === "iso" ? schedule[field].form.value : "");

    return (
        <Paper p={8} mb={8}>
            <Group justify="space-between" mb={6}>
                <Text fz="xs" fw={600} tt="uppercase" c="dimmed">
                    leg {at + 1}
                </Text>
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => dispatch(workbookActions.legRemoved(at))}>
                    ×
                </ActionIcon>
            </Group>

            <Group gap="xs" grow align="flex-start">
                <ChoiceSelect label="kind" choices={LEG_KINDS} value={leg.kind} error={kindError} onChange={next => dispatch(workbookActions.legKindSet({at, kind: next}))} />
                <div>
                    <Text fz="xs" fw={500}>
                        direction
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        mt={2}
                        value={leg.pays ? String(leg.pays) : ""}
                        data={[
                            {value: String(Flag.TRUE), label: "pays"},
                            {value: String(Flag.FALSE), label: "receives"}
                        ]}
                        onChange={value => dispatch(workbookActions.legPaysSet({at, flag: Number(value)}))}
                    />
                    {paysError && (
                        <Text fz="xs" c="red" mt={2}>
                            {paysError}
                        </Text>
                    )}
                </div>
            </Group>

            <Group gap="xs" grow mt={6} align="flex-start">
                <TextInput size="xs" label="start" placeholder="YYYY-MM-DD" error={startError} value={iso("start")} onChange={event => dispatch(workbookActions.legScheduleDateSet({at, field: "start", value: event.currentTarget.value}))} />
                <TextInput
                    size="xs"
                    label="maturity"
                    placeholder="YYYY-MM-DD"
                    error={maturityError}
                    value={iso("maturity")}
                    onChange={event => dispatch(workbookActions.legScheduleDateSet({at, field: "maturity", value: event.currentTarget.value}))}
                />
            </Group>

            <Group gap="xs" grow mt={6} align="flex-start">
                <Select
                    size="xs"
                    label="frequency"
                    placeholder="required"
                    data={FREQUENCIES}
                    error={frequencyError}
                    value={schedule?.frequency ? String(schedule.frequency) : null}
                    onChange={value => value && dispatch(workbookActions.legScheduleSet({at, frequency: Number(value)}))}
                />
                <Select
                    size="xs"
                    label="convention"
                    placeholder="required"
                    data={CONVENTIONS}
                    error={conventionError}
                    value={schedule?.convention ? String(schedule.convention) : null}
                    onChange={value => value && dispatch(workbookActions.legScheduleSet({at, convention: Number(value)}))}
                />
            </Group>

            <Group gap="xs" grow mt={6} align="flex-start">
                <Select
                    size="xs"
                    label="date generation"
                    placeholder="required"
                    data={DATE_GENERATION}
                    error={generationError}
                    value={schedule?.dateGeneration ? String(schedule.dateGeneration) : null}
                    onChange={value => value && dispatch(workbookActions.legScheduleSet({at, dateGeneration: Number(value)}))}
                />
                <Select
                    size="xs"
                    label="termination convention"
                    description="defaults to the convention above"
                    placeholder="same as convention"
                    data={CONVENTIONS}
                    clearable
                    value={schedule?.terminationConvention ? String(schedule.terminationConvention) : null}
                    onChange={value => dispatch(workbookActions.legScheduleSet({at, terminationConvention: Number(value ?? 0)}))}
                />
            </Group>

            <div style={{marginTop: 6}}>
                <CalendarControl label="calendar" value={schedule?.calendar} error={calendarError} onChange={next => dispatch(workbookActions.legScheduleSet({at, calendar: next}))} />
            </div>

            <Text fz="xs" fw={500} mt={8}>
                end of month
            </Text>
            <SegmentedControl
                size="xs"
                fullWidth
                mt={2}
                value={schedule?.endOfMonth ? String(schedule.endOfMonth) : ""}
                data={[
                    {value: String(Flag.FALSE), label: "false"},
                    {value: String(Flag.TRUE), label: "true"}
                ]}
                onChange={value => dispatch(workbookActions.legScheduleSet({at, endOfMonth: Number(value)}))}
            />
            {eomError && (
                <Text fz="xs" c="red" mt={2}>
                    {eomError}
                </Text>
            )}

            <div style={{marginTop: 8}}>
                <DayCounterControl label="day counter" value={leg.dayCounter} error={dayCounterError} onChange={next => dispatch(workbookActions.legDayCounterSet({at, dayCounter: next}))} />
            </div>

            <ParsedTextInput
                size="xs"
                mt={6}
                label="notionals"
                description="one for a constant notional, one per period for an amortising one"
                error={notionalsError}
                value={leg.notionals}
                format={formatNumberList}
                parse={parseNumberList}
                onValue={values => dispatch(workbookActions.legNumbersSet({at, field: "notionals", values}))}
            />

            {leg.kind === Leg_Kind.FIXED && (
                <>
                    <Select
                        size="xs"
                        mt={6}
                        label="rate quote"
                        placeholder="required"
                        data={quotes}
                        searchable
                        error={rateError}
                        value={leg.rateQuoteId || null}
                        onChange={value => dispatch(workbookActions.legTextSet({at, field: "rateQuoteId", value: value ?? ""}))}
                    />
                    <Text fz={10} c="yellow" mt={4}>
                        FixedRateLeg takes a value, not a handle: this rate is read once at construction. Moving the quote needs a new price, not an UpdateMarket.
                    </Text>
                </>
            )}

            {leg.kind === Leg_Kind.IBOR && (
                <>
                    <Group gap="xs" grow mt={6} align="flex-start">
                        <Select
                            size="xs"
                            label="index"
                            placeholder="required"
                            data={indices}
                            searchable
                            error={indexError}
                            value={leg.indexId || null}
                            onChange={value => dispatch(workbookActions.legTextSet({at, field: "indexId", value: value ?? ""}))}
                        />
                        {/* Empty is the index's own fixing days, and 0 a setting of its
                            own: the field has presence so the two are not one. */}
                        <NumberInput
                            size="xs"
                            label="fixing days"
                            placeholder="from the index"
                            min={0}
                            allowDecimal={false}
                            value={leg.fixingDays ?? ""}
                            onChange={value => dispatch(workbookActions.legFixingDaysSet({at, value: value === "" ? undefined : Math.max(0, Math.trunc(Number(value)))}))}
                        />
                    </Group>
                    <Group gap="xs" grow mt={6} align="flex-start">
                        <ParsedTextInput size="xs" label="spreads" value={leg.spreads} format={formatNumberList} parse={parseNumberList} onValue={values => dispatch(workbookActions.legNumbersSet({at, field: "spreads", values}))} />
                        <ParsedTextInput size="xs" label="gearings" value={leg.gearings} format={formatNumberList} parse={parseNumberList} onValue={values => dispatch(workbookActions.legNumbersSet({at, field: "gearings", values}))} />
                    </Group>
                    <Text fz="xs" fw={500} mt={8}>
                        in arrears
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        mt={2}
                        value={leg.inArrears ? String(leg.inArrears) : ""}
                        data={[
                            {value: String(Flag.FALSE), label: "false"},
                            {value: String(Flag.TRUE), label: "true"}
                        ]}
                        onChange={value => dispatch(workbookActions.legInArrearsSet({at, flag: Number(value)}))}
                    />
                    {inArrearsError && (
                        <Text fz="xs" c="red" mt={2}>
                            {inArrearsError}
                        </Text>
                    )}
                    <Text fz={10} c="dimmed" mt={4}>
                        Caps, floors, a per-leg discount curve and a per-leg currency are in the schema and rejected by this build, so they are not offered.
                    </Text>
                </>
            )}
        </Paper>
    );
};

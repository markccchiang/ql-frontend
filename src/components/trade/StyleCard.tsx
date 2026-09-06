import {Group, NumberInput, Paper, SegmentedControl, Text, Textarea, TextInput} from "@mantine/core";

import {Payoff_OptionType} from "@/gen/quantlib/v2/instrument_pb";
import {Flag} from "@/gen/quantlib/v2/market_pb";
import {AVERAGINGS, BARRIER_TYPES, DOUBLE_BARRIER_TYPES, exercisesFor, isDigitalPayoff, type PayoffCase, type StyleCase, STYLES} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {ChoiceSelect} from "./ChoiceSelect";
import {useFieldError} from "./useFieldIssue";

const BASE = "instrument.option";

/** The style block.
 *
 *  A oneof, not a feature list: QuantLib has a fixed menu of instrument
 *  classes and there is no quanto-barrier-lookback, so a repeated list would
 *  promise a product space most of which cannot be built.
 */
export const StyleCard = () => {
    const dispatch = useAppDispatch();
    const style = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" ? kind.value.style : undefined;
    });

    // A binary payoff turns the barrier into a knock digital, which is a
    // different engine with rules of its own.
    const isKnockDigital = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" && kind.value.style.case === "barrier" && isDigitalPayoff(kind.value.payoff?.kind.case as PayoffCase | undefined);
    });

    const barrierTypeError = useFieldError(`${BASE}.barrier.type`);
    const rebateError = useFieldError(`${BASE}.barrier.rebate`);
    const levelError = useFieldError(`${BASE}.barrier.level`);
    const lowerError = useFieldError(`${BASE}.double_barrier.lower`);
    const doubleTypeError = useFieldError(`${BASE}.double_barrier.type`);
    const averagingError = useFieldError(`${BASE}.asian.averaging`);
    const extremumError = useFieldError(`${BASE}.lookback.running_extremum`);
    const resetError = useFieldError(`${BASE}.forward_start.reset`);
    const performanceError = useFieldError(`${BASE}.forward_start.performance`);
    const daughterPayoffError = useFieldError(`${BASE}.compound.daughter_payoff`);
    const daughterTypeError = useFieldError(`${BASE}.compound.daughter_payoff.type`);
    const daughterStrikeError = useFieldError(`${BASE}.compound.daughter_payoff.plain.strike`);
    const daughterExerciseError = useFieldError(`${BASE}.compound.daughter_exercise.type`);
    const daughterDatesError = useFieldError(`${BASE}.compound.daughter_exercise.dates`);
    const resetDatesError = useFieldError(`${BASE}.cliquet.reset_dates`);
    const cliquetPerformanceError = useFieldError(`${BASE}.cliquet.performance`);
    const choiceDateError = useFieldError(`${BASE}.chooser.choice_date`);
    const putStrikeError = useFieldError(`${BASE}.chooser.put_strike`);
    const putExpiryError = useFieldError(`${BASE}.chooser.put_expiry`);

    if (!style) return null;

    return (
        <Paper>
            <Text fw={600} fz="xs" tt="uppercase" c="dimmed" mb={6}>
                style
            </Text>

            <ChoiceSelect label="style" description="quanto composes over these rather than multiplying them" choices={STYLES} value={style.case} onChange={next => dispatch(workbookActions.styleSet(next as StyleCase))} />

            {style.case === "barrier" && (
                <>
                    <ChoiceSelect label="type" choices={BARRIER_TYPES} value={style.value.type} error={barrierTypeError} onChange={next => dispatch(workbookActions.barrierTypeSet(next))} />
                    <Group gap="xs" grow mt={6} align="flex-start">
                        <NumberInput size="xs" label="level" decimalScale={6} error={levelError} value={style.value.level} onChange={value => dispatch(workbookActions.barrierNumberSet({field: "level", value: Number(value) || 0}))} />
                        <NumberInput size="xs" label="rebate" decimalScale={6} error={rebateError} value={style.value.rebate} onChange={value => dispatch(workbookActions.barrierNumberSet({field: "rebate", value: Number(value) || 0}))} />
                    </Group>
                    <Text fz={10} c="dimmed" mt={4}>
                        Continuously monitored. Discrete monitoring dates and partial-time windows are in the schema and not implemented, so they are not offered.
                    </Text>
                    {isKnockDigital && (
                        <Text fz={10} c="dimmed" mt={4}>
                            A binary payoff makes this a <b>knock digital</b> &mdash; the trade the schema&rsquo;s digital style describes, which has no instrument of its own in QuantLib. It prices analytically on an American exercise
                            settled at expiry, and takes no rebate: AnalyticBinaryBarrierEngine never reads one.
                        </Text>
                    )}
                </>
            )}

            {style.case === "doubleBarrier" && (
                <>
                    <ChoiceSelect label="type" choices={DOUBLE_BARRIER_TYPES} value={style.value.type} error={doubleTypeError} onChange={next => dispatch(workbookActions.doubleBarrierTypeSet(next))} />
                    <Group gap="xs" grow mt={6} align="flex-start">
                        <NumberInput size="xs" label="lower" decimalScale={6} error={lowerError} value={style.value.lower} onChange={value => dispatch(workbookActions.doubleBarrierNumberSet({field: "lower", value: Number(value) || 0}))} />
                        <NumberInput size="xs" label="upper" decimalScale={6} value={style.value.upper} onChange={value => dispatch(workbookActions.doubleBarrierNumberSet({field: "upper", value: Number(value) || 0}))} />
                        <NumberInput size="xs" label="rebate" decimalScale={6} value={style.value.rebate} onChange={value => dispatch(workbookActions.doubleBarrierNumberSet({field: "rebate", value: Number(value) || 0}))} />
                    </Group>
                </>
            )}

            {style.case === "asian" && (
                <>
                    <ChoiceSelect label="averaging" choices={AVERAGINGS} value={style.value.averaging} error={averagingError} onChange={next => dispatch(workbookActions.asianAveragingSet(next))} />
                    <Textarea
                        size="xs"
                        mt={6}
                        label="fixing dates"
                        description="empty means continuously averaged, which has a closed form for the geometric average only"
                        autosize
                        minRows={2}
                        value={style.value.fixingDates.map(date => (date.form.case === "iso" ? date.form.value : "")).join("\n")}
                        onChange={event =>
                            dispatch(
                                workbookActions.asianFixingDatesSet(
                                    event.currentTarget.value
                                        .split("\n")
                                        .map(line => line.trim())
                                        .filter(Boolean)
                                )
                            )
                        }
                    />
                    <Group gap="xs" grow mt={6} align="flex-start">
                        <NumberInput size="xs" label="running average" decimalScale={6} value={style.value.runningAverage} onChange={value => dispatch(workbookActions.asianNumberSet({field: "runningAverage", value: Number(value) || 0}))} />
                        <NumberInput size="xs" label="past fixings" min={0} value={style.value.pastFixings} onChange={value => dispatch(workbookActions.asianNumberSet({field: "pastFixings", value: Number(value) || 0}))} />
                    </Group>
                    <Text fz={10} c="dimmed" mt={4}>
                        Required once the first fixing has passed: an option mid-life whose running average is dropped prices as if it had just started.
                    </Text>
                </>
            )}

            {style.case === "lookback" && (
                <>
                    <NumberInput
                        size="xs"
                        mt={6}
                        label="running extremum"
                        description="the extremum realised so far; must be positive"
                        decimalScale={6}
                        error={extremumError}
                        value={style.value.runningExtremum}
                        onChange={value => dispatch(workbookActions.lookbackExtremumSet(Number(value) || 0))}
                    />
                    <Text fz={10} c="dimmed" mt={4}>
                        Continuous only. A floating-strike payoff selects the floating instrument; a struck one gives the fixed-strike lookback.
                    </Text>
                </>
            )}

            {style.case === "compound" && (
                <>
                    <Text fz={10} c="dimmed" mt={6}>
                        The option this one is written on. The compound&rsquo;s own payoff and exercise are the trade&rsquo;s, above &mdash; mother_payoff and mother_exercise in the schema are those two fields a second time, and the backend
                        refuses them by name rather than choosing which copy wins.
                    </Text>
                    <Text fz="xs" fw={500} mt={8}>
                        underlying option
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        mt={4}
                        value={style.value.daughterPayoff?.type ? String(style.value.daughterPayoff.type) : ""}
                        data={[
                            {value: String(Payoff_OptionType.CALL), label: "call"},
                            {value: String(Payoff_OptionType.PUT), label: "put"}
                        ]}
                        onChange={value => dispatch(workbookActions.compoundDaughterTypeSet(Number(value)))}
                    />
                    {(daughterTypeError ?? daughterPayoffError) && (
                        <Text fz="xs" c="red" mt={2}>
                            {daughterTypeError ?? daughterPayoffError}
                        </Text>
                    )}
                    <Group gap="xs" grow mt={6} align="flex-start">
                        <NumberInput
                            size="xs"
                            label="strike"
                            description="plain only: the engine casts both payoffs back to a plain one"
                            decimalScale={6}
                            error={daughterStrikeError}
                            value={style.value.daughterPayoff?.kind.case === "plain" ? style.value.daughterPayoff.kind.value.strike : 0}
                            onChange={value => dispatch(workbookActions.compoundDaughterStrikeSet(Number(value) || 0))}
                        />
                        <TextInput
                            size="xs"
                            label="expiry"
                            description="on or after the compound's own"
                            placeholder="YYYY-MM-DD"
                            error={daughterDatesError}
                            value={style.value.daughterExercise?.dates[0]?.form.case === "iso" ? style.value.daughterExercise.dates[0].form.value : ""}
                            onChange={event => dispatch(workbookActions.compoundDaughterExpirySet(event.currentTarget.value))}
                        />
                    </Group>
                    <ChoiceSelect
                        label="exercise"
                        choices={exercisesFor("compound", false)}
                        value={style.value.daughterExercise?.type}
                        error={daughterExerciseError}
                        onChange={next => dispatch(workbookActions.compoundDaughterExerciseTypeSet(next))}
                    />
                </>
            )}

            {style.case === "cliquet" && (
                <>
                    <Textarea
                        size="xs"
                        mt={6}
                        label="reset dates"
                        description="one per line, in order, each before the expiry: the strike is reset to moneyness x the spot on each"
                        autosize
                        minRows={2}
                        error={resetDatesError}
                        value={style.value.resetDates.map(date => (date.form.case === "iso" ? date.form.value : "")).join("\n")}
                        onChange={event =>
                            dispatch(
                                workbookActions.cliquetResetDatesSet(
                                    event.currentTarget.value
                                        .split("\n")
                                        .map(line => line.trim())
                                        .filter(Boolean)
                                )
                            )
                        }
                    />
                    <Text fz="xs" fw={500} mt={8}>
                        performance
                    </Text>
                    <Text fz={10} c="dimmed" mb={4}>
                        Pays the return of each period rather than the amount &mdash; a different engine, and the only one with a Monte Carlo form. A Flag with no default, as it is on a forward start.
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        value={style.value.performance ? String(style.value.performance) : ""}
                        data={[
                            {value: String(Flag.FALSE), label: "ratchet"},
                            {value: String(Flag.TRUE), label: "performance"}
                        ]}
                        onChange={value => dispatch(workbookActions.cliquetPerformanceSet(Number(value)))}
                    />
                    {cliquetPerformanceError && (
                        <Text fz="xs" c="red" mt={2}>
                            {cliquetPerformanceError}
                        </Text>
                    )}
                    <Text fz={10} c="dimmed" mt={4}>
                        Caps and floors are in the schema and are not offered: CliquetOption never copies them to an engine, so a capped cliquet would price as the uncapped ratchet and report nothing amiss.
                    </Text>
                </>
            )}

            {style.case === "chooser" && (
                <>
                    <TextInput
                        size="xs"
                        mt={6}
                        label="choice date"
                        description="when the holder decides which side this is: after today, before every expiry"
                        placeholder="YYYY-MM-DD"
                        error={choiceDateError}
                        value={style.value.choiceDate?.form.case === "iso" ? style.value.choiceDate.form.value : ""}
                        onChange={event => dispatch(workbookActions.chooserChoiceDateSet(event.currentTarget.value))}
                    />
                    <Text fz={10} c="dimmed" mt={4}>
                        The strike and the expiry are the trade&rsquo;s own payoff and exercise, above &mdash; call_strike and call_expiry in the schema are those two fields a second time. There is no call or put here: which side this
                        becomes is what is being chosen, and the payoff type is left unset.
                    </Text>

                    <Text fz="xs" fw={500} mt={8}>
                        put leg
                    </Text>
                    <Text fz={10} c="dimmed" mb={4}>
                        Off is the <b>simple</b> chooser, which shares one strike and one expiry between the two sides. On is the <b>complex</b> one, a different instrument and a different engine.
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        value={style.value.putExpiry ? "complex" : "simple"}
                        data={[
                            {value: "simple", label: "shared"},
                            {value: "complex", label: "its own"}
                        ]}
                        onChange={value => dispatch(workbookActions.chooserPutLegToggled(value === "complex"))}
                    />
                    {style.value.putExpiry && (
                        <>
                            <Group gap="xs" grow mt={6} align="flex-start">
                                <NumberInput size="xs" label="put strike" decimalScale={6} error={putStrikeError} value={style.value.putStrike} onChange={value => dispatch(workbookActions.chooserPutStrikeSet(Number(value) || 0))} />
                                <TextInput
                                    size="xs"
                                    label="put expiry"
                                    placeholder="YYYY-MM-DD"
                                    error={putExpiryError}
                                    value={style.value.putExpiry.form.case === "iso" ? style.value.putExpiry.form.value : ""}
                                    onChange={event => dispatch(workbookActions.chooserPutExpirySet(event.currentTarget.value))}
                                />
                            </Group>
                            <Text fz={10} c="dimmed" mt={4}>
                                Each leg has to expire more than twice the choice date out: AnalyticComplexChooserEngine solves for the critical spot at (expiry &minus; 2 &times; choice time), and below that the volatility surface is asked
                                for a negative time.
                            </Text>
                        </>
                    )}
                </>
            )}

            {style.case === "forwardStart" && (
                <>
                    <TextInput
                        size="xs"
                        mt={6}
                        label="reset"
                        description="the strike is set here, as moneyness x the spot at reset"
                        placeholder="YYYY-MM-DD"
                        error={resetError}
                        value={style.value.reset?.form.case === "iso" ? style.value.reset.form.value : ""}
                        onChange={event => dispatch(workbookActions.forwardStartResetSet(event.currentTarget.value))}
                    />
                    <Text fz="xs" fw={500} mt={8}>
                        performance
                    </Text>
                    <Text fz={10} c="dimmed" mb={4}>
                        Pays the return rather than the amount — a different engine, not a scaling of the same number, so it is a Flag with no default.
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        value={style.value.performance ? String(style.value.performance) : ""}
                        data={[
                            {value: String(Flag.FALSE), label: "false"},
                            {value: String(Flag.TRUE), label: "true"}
                        ]}
                        onChange={value => dispatch(workbookActions.forwardStartPerformanceSet(Number(value)))}
                    />
                    {performanceError && (
                        <Text fz="xs" c="red" mt={2}>
                            {performanceError}
                        </Text>
                    )}
                </>
            )}
        </Paper>
    );
};

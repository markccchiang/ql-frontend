import {ActionIcon, Button, Group, Paper, Select, Text, TextInput} from "@mantine/core";

import {BusinessDayConvention, Frequency} from "@/gen/quantlib/v1/conventions_pb";
import type {BootstrappedCurve} from "@/gen/quantlib/v2/market_pb";
import {enumOptions} from "@/lib/enums";
import {asQuote} from "@/market/model";
import type {Issue} from "@/market/validation";
import {BOOTSTRAP_INTERPOLATORS, BOOTSTRAP_TRAITS, PILLAR_KINDS, pillarNeedsFixedConventions} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {CalendarControl, DayCounterControl} from "../conventions/ConventionControls";
import {ChoiceSelect} from "../trade/ChoiceSelect";

const FREQUENCIES = enumOptions(Frequency);
const CONVENTIONS = enumOptions(BusinessDayConvention);

/** A curve stripped from live instrument quotes.
 *
 *  The traits/interpolator pair is a menu rather than an open choice:
 *  PiecewiseYieldCurve\<Traits, Interpolator\> is a template, so each pair is a
 *  distinct compiled type and the nine that exist are the schema. Every helper
 *  takes its quote as a handle, so writing a pillar moves the curve and
 *  everything discounting off it.
 */
export const BootstrapEditor = ({id, curve, issues}: {id: string; curve: BootstrappedCurve; issues: Issue[]}) => {
    const dispatch = useAppDispatch();
    const market = useAppSelector(state => state.workbook.market);
    const quotes = market.filter(object => asQuote(object) !== null).map(object => ({value: object.id, label: object.id}));
    const indices = market.filter(object => object.kind.case === "index").map(object => ({value: object.id, label: object.id}));
    const errorFor = (path: string) => issues.find(issue => issue.path === path && issue.severity === "error")?.message;

    return (
        <>
            <Group gap="xs" grow align="flex-start">
                <ChoiceSelect label="traits" choices={BOOTSTRAP_TRAITS} value={curve.traits} error={errorFor("yield_curve.bootstrap.traits")} onChange={next => dispatch(workbookActions.bootstrapTraitsSet({id, traits: next}))} />
                <ChoiceSelect
                    label="interpolator"
                    choices={BOOTSTRAP_INTERPOLATORS}
                    value={curve.interpolator}
                    error={errorFor("yield_curve.bootstrap.interpolator")}
                    onChange={next => dispatch(workbookActions.bootstrapInterpolatorSet({id, interpolator: next}))}
                />
            </Group>

            <Group justify="space-between" mt={8} mb={4}>
                <Text fz="xs" fw={500}>
                    pillars
                </Text>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(workbookActions.pillarAdded(id))}>
                    Add Pillar
                </Button>
            </Group>
            {errorFor("yield_curve.bootstrap.pillars") && (
                <Text fz="xs" c="red" mb={4}>
                    {errorFor("yield_curve.bootstrap.pillars")}
                </Text>
            )}

            {curve.pillars.map((pillar, at) => {
                const path = `yield_curve.bootstrap.pillars[${at}]`;
                return (
                    <Paper key={at} p={6} mb={6}>
                        <Group justify="space-between" mb={4}>
                            <Text fz={10} c="dimmed">
                                pillar {at + 1}
                            </Text>
                            <ActionIcon size="xs" variant="subtle" color="gray" aria-label={`remove pillar ${at + 1}`} onClick={() => dispatch(workbookActions.pillarRemoved({id, at}))}>
                                ×
                            </ActionIcon>
                        </Group>
                        <Group gap={6} grow align="flex-start">
                            <ChoiceSelect label="kind" choices={PILLAR_KINDS} value={pillar.kind} error={errorFor(`${path}.kind`)} onChange={next => dispatch(workbookActions.pillarKindSet({id, at, kind: next}))} />
                            <TextInput
                                size="xs"
                                label="tenor"
                                placeholder="6M"
                                error={errorFor(`${path}.tenor`)}
                                value={pillar.tenor}
                                onChange={event => dispatch(workbookActions.pillarTextSet({id, at, field: "tenor", value: event.currentTarget.value}))}
                            />
                        </Group>
                        <Group gap={6} grow mt={6} align="flex-start">
                            <Select
                                size="xs"
                                label="quote"
                                placeholder="required"
                                data={quotes}
                                searchable
                                error={errorFor(`${path}.quote_id`)}
                                value={pillar.quoteId || null}
                                onChange={value => dispatch(workbookActions.pillarTextSet({id, at, field: "quoteId", value: value ?? ""}))}
                            />
                            <Select
                                size="xs"
                                label="index"
                                description="conventions come from here"
                                placeholder="required"
                                data={indices}
                                searchable
                                error={errorFor(`${path}.index_id`)}
                                value={pillar.indexId || null}
                                onChange={value => dispatch(workbookActions.pillarTextSet({id, at, field: "indexId", value: value ?? ""}))}
                            />
                        </Group>
                        {pillarNeedsFixedConventions(pillar.kind) && (
                            <>
                                <Group gap={6} grow mt={6} align="flex-start">
                                    <Select
                                        size="xs"
                                        label="fixed frequency"
                                        placeholder="required"
                                        data={FREQUENCIES}
                                        error={errorFor(`${path}.fixed_frequency`)}
                                        value={pillar.fixedFrequency ? String(pillar.fixedFrequency) : null}
                                        onChange={value => value && dispatch(workbookActions.pillarFixedSet({id, at, frequency: Number(value)}))}
                                    />
                                    <Select
                                        size="xs"
                                        label="fixed convention"
                                        placeholder="required"
                                        data={CONVENTIONS}
                                        error={errorFor(`${path}.fixed_convention`)}
                                        value={pillar.fixedConvention ? String(pillar.fixedConvention) : null}
                                        onChange={value => value && dispatch(workbookActions.pillarFixedSet({id, at, convention: Number(value)}))}
                                    />
                                </Group>
                                <div style={{marginTop: 6}}>
                                    <CalendarControl label="calendar" value={pillar.calendar} error={errorFor(`${path}.calendar`)} onChange={next => dispatch(workbookActions.pillarFixedSet({id, at, calendar: next}))} />
                                </div>
                                <div style={{marginTop: 6}}>
                                    <DayCounterControl
                                        label="fixed day counter"
                                        value={pillar.fixedDayCounter}
                                        error={errorFor(`${path}.fixed_day_counter`)}
                                        onChange={next => dispatch(workbookActions.pillarFixedSet({id, at, dayCounter: next}))}
                                    />
                                </div>
                            </>
                        )}
                    </Paper>
                );
            })}
        </>
    );
};

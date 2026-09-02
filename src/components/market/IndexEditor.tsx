import {Group, NumberInput, SegmentedControl, Select, Text, TextInput} from "@mantine/core";

import {BusinessDayConvention} from "@/gen/quantlib/v1/conventions_pb";
import {Flag, type Index} from "@/gen/quantlib/v2/market_pb";
import {enumOptions} from "@/lib/enums";
import {asYieldCurve} from "@/market/model";
import type {Issue} from "@/market/validation";
import {INDEX_FAMILIES, indexReadsTenor} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {CalendarControl} from "../conventions/ConventionControls";
import {ChoiceSelect} from "../trade/ChoiceSelect";

const CONVENTIONS = enumOptions(BusinessDayConvention);

/** An index, built from the conventions sent rather than looked up.
 *
 *  The forwarding curve may name a curve defined later, and usually does: a
 *  bootstrapped curve's pillars name this index for their conventions while
 *  this index names that curve to forecast off. The service links it when the
 *  curve appears.
 */
export const IndexEditor = ({id, index, issues}: {id: string; index: Index; issues: Issue[]}) => {
    const dispatch = useAppDispatch();
    const market = useAppSelector(state => state.workbook.market);
    const curves = market.filter(object => asYieldCurve(object) !== null).map(object => ({value: object.id, label: object.displayName ? `${object.id} — ${object.displayName}` : object.id}));
    const errorFor = (path: string) => issues.find(issue => issue.path === path && issue.severity === "error")?.message;
    const isIbor = indexReadsTenor(index.family);

    return (
        <>
            <ChoiceSelect label="family" choices={INDEX_FAMILIES} value={index.family} error={errorFor("index.family")} onChange={next => dispatch(workbookActions.indexFamilySet({id, family: next}))} />
            <Group gap="xs" grow mt={6} align="flex-start">
                <TextInput
                    size="xs"
                    label="name"
                    placeholder="Euribor, SOFR"
                    description="the QuantLib index name"
                    error={errorFor("index.name")}
                    value={index.name}
                    onChange={event => dispatch(workbookActions.indexTextSet({id, field: "name", value: event.currentTarget.value}))}
                />
                {isIbor && (
                    <TextInput
                        size="xs"
                        label="tenor"
                        placeholder="3M"
                        error={errorFor("index.tenor")}
                        value={index.tenor}
                        onChange={event => dispatch(workbookActions.indexTextSet({id, field: "tenor", value: event.currentTarget.value}))}
                    />
                )}
                <NumberInput size="xs" label="fixing days" min={0} value={index.fixingDays} onChange={value => dispatch(workbookActions.indexFixingDaysSet({id, value: Number(value) || 0}))} />
            </Group>

            <div style={{marginTop: 6}}>
                <CalendarControl label="fixing calendar" value={index.fixingCalendar} error={errorFor("index.fixing_calendar")} onChange={next => dispatch(workbookActions.calendarSet({id, calendar: next}))} />
            </div>

            {isIbor ? (
                <>
                    <Select
                        size="xs"
                        mt={6}
                        label="business-day convention"
                        placeholder="required"
                        data={CONVENTIONS}
                        error={errorFor("index.convention")}
                        value={index.convention ? String(index.convention) : null}
                        onChange={value => value && dispatch(workbookActions.indexConventionSet({id, convention: Number(value)}))}
                    />
                    <Text fz="xs" fw={500} mt={8}>
                        end of month
                    </Text>
                    <Text fz={10} c="dimmed" mb={4}>
                        Moves fixing and payment dates, so it is a Flag with no default.
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        value={index.endOfMonth ? String(index.endOfMonth) : ""}
                        data={[
                            {value: String(Flag.FALSE), label: "false"},
                            {value: String(Flag.TRUE), label: "true"}
                        ]}
                        onChange={value => dispatch(workbookActions.indexEndOfMonthSet({id, flag: Number(value)}))}
                    />
                    {errorFor("index.end_of_month") && (
                        <Text fz="xs" c="red" mt={2}>
                            {errorFor("index.end_of_month")}
                        </Text>
                    )}
                </>
            ) : (
                <Text fz={10} c="dimmed" mt={6}>
                    An overnight index takes only a name, fixing days, a calendar and a day counter; the tenor, convention and end-of-month flag are not read.
                </Text>
            )}

            <Select
                size="xs"
                mt={6}
                label="forwarding curve"
                description="may name a curve defined later; empty means past fixings only"
                placeholder="none"
                data={curves}
                clearable
                searchable
                value={index.forwardingCurveId || null}
                onChange={value => dispatch(workbookActions.indexTextSet({id, field: "forwardingCurveId", value: value ?? ""}))}
            />
        </>
    );
};

import {Select} from "@mantine/core";

import {type Calendar, Calendar_Name, Calendar_UnitedKingdomMarket, Calendar_UnitedStatesMarket, type DayCounter, DayCounter_ActualActualConvention, DayCounter_Family, DayCounter_Thirty360Convention} from "@/gen/quantlib/v1/conventions_pb";
import {enumOptions} from "@/lib/enums";

const CALENDARS = enumOptions(Calendar_Name, ["JOINT"]);
const US_MARKETS = enumOptions(Calendar_UnitedStatesMarket);
const UK_MARKETS = enumOptions(Calendar_UnitedKingdomMarket);
const DAY_COUNTERS = enumOptions(DayCounter_Family);
const THIRTY_360 = enumOptions(DayCounter_Thirty360Convention);
const ACTUAL_ACTUAL = enumOptions(DayCounter_ActualActualConvention);

/** A calendar, and the market a calendar sometimes needs.
 *
 *  UnitedStates has no default constructor in QuantLib and UnitedKingdom's
 *  default is not the one the registry will accept, so the sub-convention
 *  appears the moment it becomes required rather than being defaulted.
 */
export const CalendarControl = ({label, value, error, onChange}: {label: string; value?: Calendar; error?: string; onChange: (next: Calendar) => void}) => {
    const name = value?.name ?? Calendar_Name.NAME_UNSPECIFIED;
    const blank: Calendar = {
        $typeName: "quantlib.v1.Calendar",
        name: Calendar_Name.NAME_UNSPECIFIED,
        unitedStatesMarket: 0,
        unitedKingdomMarket: 0,
        joint: []
    };
    const current = value ?? blank;

    return (
        <>
            <Select size="xs" label={label} placeholder="required" data={CALENDARS} error={error} value={name ? String(name) : null} onChange={next => next && onChange({...current, name: Number(next)})} />
            {name === Calendar_Name.UNITED_STATES && (
                <Select
                    size="xs"
                    mt={4}
                    label="US market"
                    placeholder="required"
                    data={US_MARKETS}
                    value={current.unitedStatesMarket ? String(current.unitedStatesMarket) : null}
                    onChange={next => next && onChange({...current, unitedStatesMarket: Number(next)})}
                />
            )}
            {name === Calendar_Name.UNITED_KINGDOM && (
                <Select
                    size="xs"
                    mt={4}
                    label="UK market"
                    placeholder="required"
                    data={UK_MARKETS}
                    value={current.unitedKingdomMarket ? String(current.unitedKingdomMarket) : null}
                    onChange={next => next && onChange({...current, unitedKingdomMarket: Number(next)})}
                />
            )}
        </>
    );
};

/** A day counter, and the sub-convention two families cannot do without: the
 *  30/360 and act/act variants differ in the year fraction, so the registry
 *  refuses to pick one. */
export const DayCounterControl = ({label, value, error, onChange}: {label: string; value?: DayCounter; error?: string; onChange: (next: DayCounter) => void}) => {
    const blank: DayCounter = {$typeName: "quantlib.v1.DayCounter", family: DayCounter_Family.FAMILY_UNSPECIFIED, thirty360: 0, actualActual: 0};
    const current = value ?? blank;

    return (
        <>
            <Select
                size="xs"
                label={label}
                placeholder="required"
                data={DAY_COUNTERS}
                error={error}
                value={current.family ? String(current.family) : null}
                onChange={next => next && onChange({...current, family: Number(next), thirty360: 0, actualActual: 0})}
            />
            {current.family === DayCounter_Family.THIRTY_360 && (
                <Select
                    size="xs"
                    mt={4}
                    label="30/360 convention"
                    placeholder="required"
                    data={THIRTY_360}
                    value={current.thirty360 ? String(current.thirty360) : null}
                    onChange={next => next && onChange({...current, thirty360: Number(next)})}
                />
            )}
            {current.family === DayCounter_Family.ACTUAL_ACTUAL && (
                <Select
                    size="xs"
                    mt={4}
                    label="act/act convention"
                    placeholder="required"
                    data={ACTUAL_ACTUAL}
                    value={current.actualActual ? String(current.actualActual) : null}
                    onChange={next => next && onChange({...current, actualActual: Number(next)})}
                />
            )}
        </>
    );
};

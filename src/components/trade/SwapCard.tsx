import {Alert, Button, Group, Paper, Select, Text} from "@mantine/core";

import {asYieldCurve} from "@/market/model";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {LegCard} from "./LegCard";
import {useFieldError} from "./useFieldIssue";

/** A general n-leg swap.
 *
 *  Not a VanillaSwap: the backend builds QuantLib's general Swap from the legs
 *  it is given, which is why the fair rate has to be computed by hand and why
 *  the leg order matters for it.
 */
export const SwapCard = () => {
    const dispatch = useAppDispatch();
    const market = useAppSelector(state => state.workbook.market);
    const swap = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "swap" ? kind.value : undefined;
    });
    const curves = market.filter(object => asYieldCurve(object) !== null).map(object => ({value: object.id, label: object.displayName ? `${object.id} — ${object.displayName}` : object.id}));

    const legsError = useFieldError("instrument.swap.legs");
    const discountError = useFieldError("instrument.swap.discount_curve_id");

    if (!swap) return null;

    return (
        <Paper>
            <Group justify="space-between" mb={6}>
                <Text fw={600} fz="xs" tt="uppercase" c="dimmed">
                    swap
                </Text>
                <Button size="compact-xs" variant="default" onClick={() => dispatch(workbookActions.legAdded())}>
                    add leg
                </Button>
            </Group>

            <Select
                size="xs"
                mb={8}
                label="discount curve"
                description="DiscountingSwapEngine takes one curve for the whole swap"
                placeholder="required"
                data={curves}
                searchable
                error={discountError}
                value={swap.discountCurveId || null}
                onChange={value => dispatch(workbookActions.swapDiscountCurveSet(value ?? ""))}
            />

            {legsError && (
                <Alert color="red" p="xs" mb={8}>
                    <Text fz="xs">{legsError}</Text>
                </Alert>
            )}

            {swap.legs.map((leg, at) => (
                <LegCard key={at} at={at} leg={leg} />
            ))}

            {swap.legs.length === 0 && (
                <Text fz="xs" c="dimmed">
                    No legs yet. A swap needs at least two, and they cannot all point the same way.
                </Text>
            )}
        </Paper>
    );
};

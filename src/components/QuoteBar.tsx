import {useEffect, useMemo, useState} from "react";
import {Group, NumberInput, Paper, Slider, Text, Tooltip} from "@mantine/core";

import type {Quote_Unit} from "@/gen/quantlib/v2/market_pb";
import {displayFactor, unitLabel, unitSuffix} from "@/lib/units";
import {asQuote, defaultRange} from "@/market/model";
import {bumpQuote, repricesLive} from "@/session/repricer";
import {runScenario} from "@/session/scenario";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {scenarioActions} from "@/store/scenarioSlice";
import {selectFrozenQuoteIds, selectQuotes} from "@/store/selectors";
import {workbookActions} from "@/store/workbookSlice";

/** One quote's slider, on a range that holds still while it is dragged.
 *
 *  A price quote's natural range is around its value, and taking that from
 *  the value being dragged moved the range with the thumb: every render put
 *  the thumb back in the middle, and the step changed on every tick. The
 *  range comes from an anchor instead, which moves only when the value leaves
 *  it -- typed into the box, written by a sweep -- or when a drag is let go at
 *  the top, which is how a user asks for more room. Rates, volatilities and
 *  correlations have fixed ranges, and for them the anchor changes nothing.
 */
const QuoteSlider = ({id, unit, value, isDisabled, isContinuous}: {id: string; unit: Quote_Unit; value: number; isDisabled: boolean; isContinuous: boolean}) => {
    const dispatch = useAppDispatch();
    const [anchor, setAnchor] = useState(value);
    const range = useMemo(() => defaultRange(unit, anchor), [unit, anchor]);
    const factor = displayFactor(unit);

    useEffect(() => {
        if (value < range.min || value > range.max) setAnchor(value);
    }, [value, range]);

    return (
        <Slider
            size="sm"
            thumbLabel={`${id} slider`}
            min={range.min}
            max={range.max}
            step={range.step}
            value={value}
            label={next => (next * factor).toFixed(2) + unitSuffix(unit)}
            disabled={isDisabled}
            onChange={next => {
                if (isContinuous) void dispatch(bumpQuote(id, next));
                else dispatch(workbookActions.quoteValueSet({id, value: next}));
            }}
            onChangeEnd={next => {
                if (next >= range.max - range.step) setAnchor(next);
                void dispatch(bumpQuote(id, next));
            }}
        />
    );
};

/** The strip a user actually drags for an hour.
 *
 *  A quote write is the one edit UpdateMarket can carry to a live graph, so
 *  this is the only place in the app where an edit costs nothing. Above a
 *  latency budget the sliders stop repricing continuously and wait for the
 *  release instead — an FD FINE grid or a Monte Carlo is not a slider.
 */
export const QuoteBar = () => {
    const dispatch = useAppDispatch();
    const quotes = useAppSelector(selectQuotes);
    const isLive = useAppSelector(s => s.session.status === "live");
    const frozen = useAppSelector(selectFrozenQuoteIds);
    const lastRoundTripMs = useAppSelector(s => s.connection.lastRoundTripMs);
    const isContinuous = repricesLive(lastRoundTripMs);

    /** One gesture: right-click a quote and it is swept +/-20% around where it
     *  stands, plotting whatever kind the sweep panel last used. The first axis
     *  is replaced rather than added to, so the gesture stays one ladder even
     *  when the panel is set up as a grid. */
    const sweep = (quoteId: string) => {
        dispatch(
            scenarioActions.axisChanged({
                at: 0,
                change: {
                    quoteId,
                    form: "relative",
                    factors: [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2]
                }
            })
        );
        void dispatch(runScenario());
    };

    if (quotes.length === 0) return null;

    return (
        <Paper data-testid="quote-bar" p="xs" radius={0} style={{borderLeft: 0, borderRight: 0, borderBottom: 0}}>
            <Group gap="lg" wrap="wrap" align="flex-end">
                {quotes.map(object => {
                    const quote = asQuote(object)!;
                    const isFrozen = frozen.has(object.id);
                    const factor = displayFactor(quote.unit);
                    return (
                        <div
                            key={object.id}
                            style={{minWidth: 210, flex: "1 1 210px"}}
                            onContextMenu={event => {
                                if (!isLive) return;
                                event.preventDefault();
                                sweep(object.id);
                            }}
                        >
                            <Group justify="space-between" gap={4} wrap="nowrap">
                                <Tooltip label={isFrozen ? "A fixed leg reads its rate once at construction: price the trade again to move it." : `${object.displayName || object.id} · ${unitLabel(quote.unit)}`}>
                                    <Text fz="xs" ff="monospace" fw={700} c={isFrozen ? "yellow" : undefined}>
                                        {object.id}
                                    </Text>
                                </Tooltip>
                                <NumberInput
                                    size="xs"
                                    aria-label={`${object.id} value`}
                                    w={110}
                                    hideControls
                                    decimalScale={4}
                                    suffix={unitSuffix(quote.unit)}
                                    value={Number((quote.value * factor).toFixed(6))}
                                    onChange={value => {
                                        // A string is a box being edited -- cleared, or a
                                        // lone "-" on the way to a negative rate -- and is
                                        // not a value. Read as zero, it went to the live
                                        // graph as one.
                                        if (typeof value !== "number") return;
                                        void dispatch(bumpQuote(object.id, value / factor));
                                    }}
                                />
                            </Group>
                            <QuoteSlider id={object.id} unit={quote.unit} value={quote.value} isDisabled={!isLive || isFrozen} isContinuous={isContinuous} />
                        </div>
                    );
                })}
            </Group>
            {!isContinuous && (
                <Text fz="xs" c="dimmed" mt={4}>
                    Last price took {lastRoundTripMs} ms — sliders reprice on release rather than continuously.
                </Text>
            )}
            {!isLive ? (
                <Text fz="xs" c="dimmed" mt={4}>
                    No live session. Values still edit the workbook; open a session to price off them.
                </Text>
            ) : (
                <Text fz="xs" c="dimmed" mt={4}>
                    Right-click a quote to sweep it ±20% off the live graph.
                </Text>
            )}
        </Paper>
    );
};

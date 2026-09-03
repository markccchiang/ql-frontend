import {Group, NumberInput, Paper, Slider, Text, Tooltip} from "@mantine/core";

import {displayFactor, unitLabel, unitSuffix} from "@/lib/units";
import {asQuote, defaultRange} from "@/market/model";
import {bumpQuote, repricesLive} from "@/session/repricer";
import {runScenario} from "@/session/scenario";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {scenarioActions} from "@/store/scenarioSlice";
import {selectFrozenQuoteIds, selectQuotes} from "@/store/selectors";
import {workbookActions} from "@/store/workbookSlice";

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
     *  stands, plotting whatever kind the sweep panel last used. */
    const sweep = (quoteId: string) => {
        dispatch(
            scenarioActions.specChanged({
                quoteId,
                form: "relative",
                factors: [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2]
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
                    const range = defaultRange(quote.unit, quote.value);
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
                                    w={110}
                                    hideControls
                                    decimalScale={4}
                                    suffix={unitSuffix(quote.unit)}
                                    value={Number((quote.value * factor).toFixed(6))}
                                    onChange={value => {
                                        const next = (typeof value === "number" ? value : Number(value) || 0) / factor;
                                        void dispatch(bumpQuote(object.id, next));
                                    }}
                                />
                            </Group>
                            <Slider
                                size="sm"
                                min={range.min}
                                max={range.max}
                                step={range.step}
                                value={quote.value}
                                label={value => (value * factor).toFixed(2) + unitSuffix(quote.unit)}
                                disabled={!isLive || isFrozen}
                                onChange={value => {
                                    if (isContinuous) void dispatch(bumpQuote(object.id, value));
                                    else dispatch(workbookActions.quoteValueSet({id: object.id, value}));
                                }}
                                onChangeEnd={value => void dispatch(bumpQuote(object.id, value))}
                            />
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

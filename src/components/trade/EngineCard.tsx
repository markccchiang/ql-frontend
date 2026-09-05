import {Checkbox, Group, NumberInput, Paper, SegmentedControl, Text} from "@mantine/core";

import {Engine_Method, FdParameters_Preset, McParameters_Rng} from "@/gen/quantlib/v2/engine_pb";
import {Asian_Averaging, Exercise_Type} from "@/gen/quantlib/v2/instrument_pb";
import {APPROXIMATIONS, engineMethodsFor, FD_SCHEMES, latticeTrees, needsApproximation, type PayoffCase, type StyleCase, supportsBatchedProgress, swapEngineMethods} from "@/protocol/capabilities";
import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {workbookActions} from "@/store/workbookSlice";

import {ChoiceSelect} from "./ChoiceSelect";
import {useFieldError} from "./useFieldIssue";

const PRESETS = [
    {value: FdParameters_Preset.COARSE, label: "coarse — 100 x 100", availability: "supported" as const},
    {value: FdParameters_Preset.STANDARD, label: "standard — 400 x 200", availability: "supported" as const},
    {value: FdParameters_Preset.FINE, label: "fine — 2000 x 800", availability: "supported" as const}
];

/** The method selects the parameter block. A field that does not apply cannot
 *  be set, rather than being set and dropped. */
export const EngineCard = () => {
    const dispatch = useAppDispatch();
    const engine = useAppSelector(state => state.workbook.trade.engine);
    const option = useAppSelector(state => {
        const kind = state.workbook.trade.instrument?.kind;
        return kind?.case === "option" ? kind.value : undefined;
    });
    const isSwap = useAppSelector(state => state.workbook.trade.instrument?.kind.case === "swap");

    const methodError = useFieldError("engine.method");
    const approximationError = useFieldError("engine.analytic.approximation");
    const treeError = useFieldError("engine.lattice.tree");
    const stepsError = useFieldError("engine.lattice.steps");
    const fdError = useFieldError("engine.fd") ?? useFieldError("engine.fd.preset");
    const schemeError = useFieldError("engine.fd.custom.scheme");
    const seedError = useFieldError("engine.mc.seed");
    const samplesError = useFieldError("engine.mc.samples");

    if (!engine) return null;

    if (isSwap) {
        return (
            <Paper>
                <Text fw={600} fz="xs" tt="uppercase" c="dimmed" mb={6}>
                    engine
                </Text>
                <ChoiceSelect label="method" choices={swapEngineMethods()} value={engine.method} error={methodError} onChange={next => dispatch(workbookActions.engineMethodSet(next))} />
                <Text fz={10} c="dimmed" mt={4}>
                    DiscountingSwapEngine takes no parameters beyond the curve.
                </Text>
            </Paper>
        );
    }

    if (!option) return null;

    const exercise = option.exercise?.type ?? Exercise_Type.UNSPECIFIED;
    const payoffCase = option.payoff?.kind.case as PayoffCase | undefined;
    const style = (option.style.case ?? "vanilla") as StyleCase;
    const asian = option.style.case === "asian" ? option.style.value : null;

    const parameters = engine.parameters;
    const grid = parameters.case === "fd" ? parameters.value.grid : null;

    return (
        <Paper>
            <Text fw={600} fz="xs" tt="uppercase" c="dimmed" mb={6}>
                engine
            </Text>

            <ChoiceSelect
                label="method"
                choices={engineMethodsFor({
                    style,
                    exercise,
                    payoff: payoffCase,
                    quanto: option.quanto !== undefined,
                    averaging: asian?.averaging ?? Asian_Averaging.UNSPECIFIED,
                    discreteAsian: (asian?.fixingDates.length ?? 0) > 0
                })}
                value={engine.method}
                error={methodError}
                onChange={next => dispatch(workbookActions.engineMethodSet(next))}
            />

            {needsApproximation(exercise, engine.method, payoffCase, style) && (
                <ChoiceSelect
                    label="approximation"
                    description="QuantLib has three and they disagree in the third decimal"
                    choices={APPROXIMATIONS}
                    value={parameters.case === "analytic" ? parameters.value.approximation : 0}
                    error={approximationError}
                    onChange={next => dispatch(workbookActions.approximationSet(next))}
                />
            )}

            {engine.method === Engine_Method.LATTICE && (
                <>
                    <ChoiceSelect label="tree" choices={latticeTrees(style)} value={parameters.case === "lattice" ? parameters.value.tree : 0} error={treeError} onChange={next => dispatch(workbookActions.latticeTreeSet(next))} />
                    <NumberInput
                        size="xs"
                        mt={6}
                        label="steps"
                        min={0}
                        error={stepsError}
                        value={parameters.case === "lattice" ? parameters.value.steps : 0}
                        onChange={value => dispatch(workbookActions.latticeStepsSet(typeof value === "number" ? value : Number(value) || 0))}
                    />
                </>
            )}

            {engine.method === Engine_Method.MONTE_CARLO && parameters.case === "mc" && (
                <>
                    <Group gap="xs" grow mt={6} align="flex-start">
                        <NumberInput
                            size="xs"
                            label="seed"
                            description="non-zero"
                            min={0}
                            error={seedError}
                            value={Number(parameters.value.seed)}
                            onChange={value => dispatch(workbookActions.mcSeedSet(BigInt(Math.max(0, Math.trunc(Number(value) || 0)))))}
                        />
                        <NumberInput
                            size="xs"
                            label="samples"
                            min={0}
                            error={samplesError}
                            value={parameters.value.stopping.case === "samples" ? Number(parameters.value.stopping.value) : 0}
                            onChange={value => dispatch(workbookActions.mcSamplesSet(BigInt(Math.max(0, Math.trunc(Number(value) || 0)))))}
                        />
                    </Group>
                    <Text fz={10} c="dimmed" mt={2}>
                        The schema also offers an absolute tolerance, but every Monte Carlo path in this build requires a sample budget, so only samples are offered.
                    </Text>
                    <Group gap="xs" grow mt={6} align="flex-start">
                        <ChoiceSelect
                            label="rng"
                            choices={[
                                {value: McParameters_Rng.PSEUDO_RANDOM, label: "pseudo-random (Mersenne)", availability: "supported" as const},
                                {value: McParameters_Rng.LOW_DISCREPANCY, label: "low discrepancy (Sobol)", availability: "unsupported" as const, reason: "The engines here are built with PseudoRandom."}
                            ]}
                            value={parameters.value.rng}
                            onChange={next => dispatch(workbookActions.mcRngSet(next))}
                        />
                        <NumberInput size="xs" label="time steps / year" min={0} value={parameters.value.timeStepsPerYear} onChange={value => dispatch(workbookActions.mcStepsPerYearSet(Number(value) || 0))} />
                    </Group>
                    <Checkbox size="xs" mt={6} label="control variate" checked={parameters.value.controlVariate} onChange={event => dispatch(workbookActions.mcToggleSet({field: "controlVariate", value: event.currentTarget.checked}))} />
                    {supportsBatchedProgress(style) ? (
                        <>
                            <NumberInput
                                size="xs"
                                mt={6}
                                label="report progress every N paths"
                                description="0 runs it in one shot"
                                min={0}
                                value={Number(parameters.value.progressEveryPaths)}
                                onChange={value => dispatch(workbookActions.mcProgressEverySet(BigInt(Math.max(0, Math.trunc(Number(value) || 0)))))}
                            />
                            <Text fz={10} c="yellow" mt={4}>
                                Batching is what emits progress and what makes a cancel possible, and it changes the price: the batches draw from the RNG stream differently from one run of the same total. Reproducibility keys on the seed,
                                the sample count and this number together.
                            </Text>
                        </>
                    ) : (
                        <Text fz={10} c="dimmed" mt={4}>
                            Progress and cancellation are for the vanilla path only: priceInBatches takes a VanillaOption, so this field would be read by nothing here.
                        </Text>
                    )}
                </>
            )}

            {engine.method === Engine_Method.FINITE_DIFFERENCE && (
                <>
                    <Text fz="xs" fw={500} mt={6} mb={2}>
                        grid
                    </Text>
                    <SegmentedControl
                        size="xs"
                        fullWidth
                        value={grid?.case ?? "preset"}
                        data={[
                            {value: "preset", label: "preset"},
                            {value: "custom", label: "explicit"}
                        ]}
                        onChange={value => dispatch(workbookActions.fdGridModeSet(value as "preset" | "custom"))}
                    />
                    {grid?.case === "preset" && <ChoiceSelect label="preset" choices={PRESETS} value={grid.value} error={fdError} onChange={next => dispatch(workbookActions.fdPresetSet(next))} />}
                    {grid?.case === "custom" && (
                        <>
                            <Group gap="xs" grow mt={6}>
                                {(["timeSteps", "assetSteps", "dampingSteps"] as const).map(field => (
                                    <NumberInput
                                        key={field}
                                        size="xs"
                                        label={field.replace(/([A-Z])/g, " $1").toLowerCase()}
                                        min={0}
                                        value={grid.value[field]}
                                        onChange={value => dispatch(workbookActions.fdCustomSet({field, value: typeof value === "number" ? value : Number(value) || 0}))}
                                    />
                                ))}
                            </Group>
                            <ChoiceSelect
                                label="scheme"
                                description="two schemes are two prices for one trade"
                                choices={FD_SCHEMES}
                                value={grid.value.scheme}
                                error={schemeError}
                                onChange={next => dispatch(workbookActions.fdSchemeSet(next))}
                            />
                        </>
                    )}
                </>
            )}
        </Paper>
    );
};

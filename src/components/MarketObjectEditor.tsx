import { Alert, Group, NumberInput, Paper, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core'
import { Compounding, DayCounter_Family, Frequency } from '@/gen/quantlib/v1/conventions_pb'
import { type MarketObject, Quote_Unit } from '@/gen/quantlib/v2/market_pb'
import { enumOptions } from '@/lib/enums'
import { displayFactor, unitSuffix } from '@/lib/units'
import { asQuote, asVolatility, asYieldCurve } from '@/market/model'
import type { Issue } from '@/market/validation'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { selectIssues, selectQuotes } from '@/store/selectors'
import { workbookActions } from '@/store/workbookSlice'

const DAY_COUNTERS = enumOptions(DayCounter_Family)
const COMPOUNDINGS = enumOptions(Compounding)
const FREQUENCIES = enumOptions(Frequency)
const UNITS = enumOptions(Quote_Unit)

function errorFor(issues: Issue[], path: string): string | undefined {
  return issues.find((issue) => issue.path === path && issue.severity === 'error')?.message
}

/** Every enum renders empty until it is chosen: proto3 cannot tell an unset
 *  enum from its first value, so a control that defaults one is a control that
 *  misprices silently. */
export function MarketObjectEditor({ object }: { object: MarketObject }) {
  const dispatch = useAppDispatch()
  const allIssues = useAppSelector(selectIssues)
  const quotes = useAppSelector(selectQuotes)
  const issues = allIssues.filter((issue) => issue.objectId === object.id)

  const quoteOptions = quotes
    .filter((candidate) => candidate.id !== object.id)
    .map((candidate) => ({ value: candidate.id, label: candidate.displayName ? `${candidate.id} — ${candidate.displayName}` : candidate.id }))

  const quote = asQuote(object)
  const curve = asYieldCurve(object)
  const surface = asVolatility(object)
  const dayCounter = curve?.dayCounter ?? surface?.dayCounter
  const dayCounterPath = curve ? 'yield_curve.day_counter' : 'volatility.day_counter'

  return (
    <Paper>
      <Group gap="xs" mb="xs" grow>
        <TextInput
          size="xs"
          label="id"
          defaultValue={object.id}
          key={object.id}
          error={errorFor(issues, 'id')}
          onBlur={(event) => {
            const to = event.currentTarget.value.trim()
            if (to && to !== object.id) dispatch(workbookActions.objectRenamed({ from: object.id, to }))
          }}
        />
        <TextInput
          size="xs"
          label="display name"
          value={object.displayName}
          onChange={(event) => dispatch(workbookActions.displayNameSet({ id: object.id, displayName: event.currentTarget.value }))}
        />
      </Group>

      {quote && (
        <Group gap="xs" grow align="flex-start">
          <NumberInput
            size="xs"
            label="value"
            value={quote.value * displayFactor(quote.unit)}
            suffix={unitSuffix(quote.unit)}
            decimalScale={6}
            step={0.01}
            onChange={(value) =>
              dispatch(
                workbookActions.quoteValueSet({
                  id: object.id,
                  value: (typeof value === 'number' ? value : Number(value) || 0) / displayFactor(quote.unit),
                }),
              )
            }
          />
          <Select
            size="xs"
            label="unit"
            placeholder="unspecified"
            data={UNITS}
            value={quote.unit ? String(quote.unit) : null}
            onChange={(value) => value && dispatch(workbookActions.quoteUnitSet({ id: object.id, unit: Number(value) }))}
          />
        </Group>
      )}

      {dayCounter !== undefined && (
        <Select
          size="xs"
          label="day counter"
          placeholder="required"
          data={DAY_COUNTERS}
          error={errorFor(issues, dayCounterPath)}
          value={dayCounter.family ? String(dayCounter.family) : null}
          onChange={(value) => value && dispatch(workbookActions.dayCounterSet({ id: object.id, family: Number(value) }))}
          mb="xs"
        />
      )}

      {curve?.shape.case === 'flat' && (
        <Stack gap="xs">
          <SourceControl
            label="rate"
            source={curve.shape.value.rate?.source ?? { case: undefined }}
            quoteOptions={quoteOptions}
            error={errorFor(issues, 'yield_curve.flat.rate') ?? errorFor(issues, 'yield_curve.flat.rate.quote_id')}
            onChange={(source) => dispatch(workbookActions.flatRateSet({ id: object.id, source }))}
          />
          <Group gap="xs" grow align="flex-start">
            <Select
              size="xs"
              label="compounding"
              placeholder="required"
              data={COMPOUNDINGS}
              error={errorFor(issues, 'yield_curve.flat.compounding')}
              value={curve.shape.value.compounding ? String(curve.shape.value.compounding) : null}
              onChange={(value) => value && dispatch(workbookActions.compoundingSet({ id: object.id, compounding: Number(value) }))}
            />
            <Select
              size="xs"
              label="frequency"
              placeholder="required"
              data={FREQUENCIES}
              error={errorFor(issues, 'yield_curve.flat.frequency')}
              value={curve.shape.value.frequency ? String(curve.shape.value.frequency) : null}
              onChange={(value) => value && dispatch(workbookActions.frequencySet({ id: object.id, frequency: Number(value) }))}
            />
          </Group>
          <Text fz="xs" c="dimmed">
            Frequency is required even under SIMPLE and CONTINUOUS, where QuantLib ignores it.
          </Text>
        </Stack>
      )}

      {surface?.shape.case === 'constant' && (
        <SourceControl
          label="volatility"
          source={surface.shape.value.volatility?.source ?? { case: undefined }}
          quoteOptions={quoteOptions}
          error={errorFor(issues, 'volatility.constant.volatility') ?? errorFor(issues, 'volatility.constant.volatility.quote_id')}
          onChange={(source) => dispatch(workbookActions.volatilitySourceSet({ id: object.id, source }))}
        />
      )}

      {issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => (
          <Alert key={issue.path} color="yellow" mt="xs" p="xs" fz="xs">
            {issue.message}
          </Alert>
        ))}
    </Paper>
  )
}

type Source = { case: 'quoteId'; value: string } | { case: 'fixed'; value: number } | { case: undefined }

/** `Number` is quote_id or fixed, and the difference is not cosmetic: a bound
 *  quote is bumpable and rebuilds what observes it, a fixed value is baked in
 *  at construction and can never move. */
function SourceControl({
  label,
  source,
  quoteOptions,
  error,
  onChange,
}: {
  label: string
  source: Source
  quoteOptions: { value: string; label: string }[]
  error?: string
  onChange: (source: { case: 'quoteId'; value: string } | { case: 'fixed'; value: number }) => void
}) {
  const mode = source.case === 'fixed' ? 'fixed' : 'quoteId'
  return (
    <div>
      <Group justify="space-between" mb={2}>
        <Text fz="xs" fw={500}>
          {label}
        </Text>
        <SegmentedControl
          size="xs"
          value={mode}
          data={[
            { value: 'quoteId', label: 'live quote' },
            { value: 'fixed', label: 'fixed' },
          ]}
          onChange={(value) =>
            onChange(value === 'fixed' ? { case: 'fixed', value: 0 } : { case: 'quoteId', value: '' })
          }
        />
      </Group>
      {mode === 'quoteId' ? (
        <Select
          size="xs"
          placeholder="pick a quote"
          data={quoteOptions}
          error={error}
          searchable
          value={source.case === 'quoteId' && source.value ? source.value : null}
          onChange={(value) => value && onChange({ case: 'quoteId', value })}
        />
      ) : (
        <NumberInput
          size="xs"
          decimalScale={6}
          error={error}
          value={source.case === 'fixed' ? source.value : 0}
          onChange={(value) => onChange({ case: 'fixed', value: typeof value === 'number' ? value : Number(value) || 0 })}
        />
      )}
    </div>
  )
}

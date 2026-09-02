import { Group, NumberInput, Paper, SegmentedControl, Text } from '@mantine/core'
import { Payoff_OptionType } from '@/gen/quantlib/v2/instrument_pb'
import { PAYOFFS, type PayoffCase } from '@/protocol/capabilities'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { workbookActions } from '@/store/workbookSlice'
import { ChoiceSelect } from './ChoiceSelect'
import { useFieldError } from './useFieldIssue'

const BASE = 'instrument.option.payoff'

/** Numeric fields per payoff arm, in the order payoffs.hpp declares them. */
const FIELDS: Record<string, { field: 'strike' | 'secondStrike' | 'cashPayoff' | 'moneyness'; label: string }[]> = {
  plain: [{ field: 'strike', label: 'strike' }],
  percentageStrike: [{ field: 'moneyness', label: 'moneyness' }],
  assetOrNothing: [{ field: 'strike', label: 'strike' }],
  cashOrNothing: [{ field: 'strike', label: 'strike' }, { field: 'cashPayoff', label: 'cash payoff' }],
  gap: [{ field: 'strike', label: 'strike' }, { field: 'secondStrike', label: 'second strike' }],
  superFund: [{ field: 'strike', label: 'strike' }, { field: 'secondStrike', label: 'second strike' }],
  superShare: [
    { field: 'strike', label: 'strike' },
    { field: 'secondStrike', label: 'second strike' },
    { field: 'cashPayoff', label: 'cash payoff' },
  ],
}

export function PayoffCard() {
  const dispatch = useAppDispatch()
  const payoff = useAppSelector((state) => {
    const kind = state.workbook.trade.instrument?.kind
    return kind?.case === 'option' ? kind.value.payoff : undefined
  })
  const typeError = useFieldError(`${BASE}.type`)
  const kindError = useFieldError(BASE)

  if (!payoff) return null
  const kind = payoff.kind.case as PayoffCase | undefined
  const values = kind ? (payoff.kind.value as unknown as Record<string, number>) : {}

  return (
    <Paper>
      <Text fw={600} fz="xs" tt="uppercase" c="dimmed" mb={6}>
        payoff
      </Text>

      <SegmentedControl
        size="xs"
        fullWidth
        mb="xs"
        value={payoff.type ? String(payoff.type) : ''}
        data={[
          { value: String(Payoff_OptionType.CALL), label: 'call' },
          { value: String(Payoff_OptionType.PUT), label: 'put' },
        ]}
        onChange={(value) => dispatch(workbookActions.payoffTypeSet(Number(value)))}
      />
      {typeError && (
        <Text fz="xs" c="red" mb={4}>
          {typeError}
        </Text>
      )}

      <ChoiceSelect
        label="kind"
        choices={PAYOFFS}
        value={kind}
        error={kindError}
        onChange={(next) => dispatch(workbookActions.payoffKindSet(next))}
      />

      {kind && (
        <Group gap="xs" grow mt="xs" align="flex-start">
          {(FIELDS[kind] ?? []).map((entry) => (
            <NumberInput
              key={entry.field}
              size="xs"
              label={entry.label}
              decimalScale={6}
              value={values[entry.field] ?? 0}
              onChange={(value) =>
                dispatch(
                  workbookActions.payoffNumberSet({
                    field: entry.field,
                    value: typeof value === 'number' ? value : Number(value) || 0,
                  }),
                )
              }
            />
          ))}
        </Group>
      )}
    </Paper>
  )
}

import { Select, Text, Tooltip } from '@mantine/core'
import type { Choice } from '@/protocol/capabilities'

/** A select over a capability list.
 *
 *  Closed options stay visible and disabled, carrying the sentence that
 *  explains them. Hiding them would leave a user wondering whether the service
 *  cannot do it or whether they cannot find it.
 */
export function ChoiceSelect<T extends number | string>({
  label,
  description,
  choices,
  value,
  error,
  onChange,
}: {
  label: string
  description?: string
  choices: Choice<T>[]
  value: T | undefined
  error?: string
  onChange: (value: T) => void
}) {
  const byValue = new Map(choices.map((choice) => [String(choice.value), choice]))

  return (
    <Select
      size="xs"
      label={label}
      description={description}
      placeholder="required"
      error={error}
      value={value === undefined || value === 0 || value === '' ? null : String(value)}
      data={choices.map((choice) => ({
        value: String(choice.value),
        label: choice.label,
        disabled: choice.availability !== 'supported',
      }))}
      renderOption={({ option }) => {
        const choice = byValue.get(option.value)
        const closed = choice && choice.availability !== 'supported'
        const body = (
          <div>
            <Text fz="xs" c={closed ? 'dimmed' : undefined}>
              {option.label}
            </Text>
            {choice?.reason && (
              <Text fz={10} c="dimmed">
                {choice.availability === 'pending' ? 'not built here yet — ' : 'not priced by this build — '}
                {choice.reason}
              </Text>
            )}
          </div>
        )
        return choice?.reason ? (
          <Tooltip label={choice.reason} multiline w={280} position="right">
            {body}
          </Tooltip>
        ) : (
          body
        )
      }}
      onChange={(next) => {
        if (next === null) return
        const choice = byValue.get(next)
        if (choice) onChange(choice.value)
      }}
    />
  )
}

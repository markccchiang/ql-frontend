import { Badge, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { HANDLERS_EVALUATION_DATE, handlersMarket } from '@/market/handlersSession'
import { formatQuote, unitLabel } from '@/lib/units'
import { useAppSelector } from '@/store/hooks'

const KIND_LABEL: Record<string, string> = {
  quote: 'quote',
  yieldCurve: 'yield curve',
  volatility: 'volatility',
  index: 'index',
  fixings: 'fixings',
}

/** M0 renders the seed market read-only. The editable pane, the DAG and the
 *  topological sort are M1; what this proves today is that SessionOpened's
 *  market_ids echo matches what we posted, object for object. */
export function MarketPane() {
  const builtIds = useAppSelector((s) => s.session.marketIds)
  const built = new Set(builtIds)
  const live = builtIds.length > 0

  return (
    <Paper h="100%" style={{ overflowY: 'auto' }}>
      <Group justify="space-between" mb="xs">
        <Text fw={600} fz="sm">
          Market
        </Text>
        <Tooltip label="OpenSession.evaluation_date — everything in the session prices against it">
          <Badge variant="default" size="sm">
            {HANDLERS_EVALUATION_DATE}
          </Badge>
        </Tooltip>
      </Group>

      <Stack gap={4}>
        {handlersMarket.map((object) => {
          const kind = object.kind?.case ?? 'unknown'
          const isQuote = kind === 'quote'
          const quote = isQuote ? (object.kind?.value as { value: number; unit: number }) : null
          return (
            <Group
              key={object.id}
              justify="space-between"
              wrap="nowrap"
              px={6}
              py={3}
              style={{
                borderRadius: 4,
                background: 'var(--mantine-color-dark-6)',
                opacity: !live || built.has(object.id!) ? 1 : 0.45,
              }}
            >
              <Group gap={6} wrap="nowrap">
                <Text fz="xs" ff="monospace" fw={700} w={38}>
                  {object.id}
                </Text>
                <Text fz="xs" c="dimmed">
                  {KIND_LABEL[kind] ?? kind}
                </Text>
              </Group>
              <Group gap={6} wrap="nowrap">
                {quote && (
                  <Tooltip label={unitLabel(quote.unit)}>
                    <Text fz="xs" ff="monospace">
                      {formatQuote(quote.value, quote.unit)}
                    </Text>
                  </Tooltip>
                )}
                {live && (
                  <Badge size="xs" variant="light" color={built.has(object.id!) ? 'teal' : 'red'}>
                    {built.has(object.id!) ? 'built' : 'missing'}
                  </Badge>
                )}
              </Group>
            </Group>
          )
        })}
      </Stack>

      <Text fz="xs" c="dimmed" mt="sm">
        Read-only in M0. Editing, the dependency graph and the quote sliders are M1.
      </Text>
    </Paper>
  )
}

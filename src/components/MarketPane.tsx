import { ActionIcon, Badge, Group, Menu, Paper, ScrollArea, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { KIND_LABEL, asQuote } from '@/market/model'
import { formatQuote } from '@/lib/units'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { selectIssues } from '@/store/selectors'
import { workbookActions } from '@/store/workbookSlice'
import { MarketObjectEditor } from './MarketObjectEditor'

export function MarketPane() {
  const dispatch = useAppDispatch()
  const { market, evaluationDate, selectedId } = useAppSelector((s) => s.workbook)
  const builtIds = useAppSelector((s) => s.session.marketIds)
  const sessionLive = useAppSelector((s) => s.session.status === 'live')
  const issues = useAppSelector(selectIssues)

  const built = new Set(builtIds)
  const selected = market.find((object) => object.id === selectedId) ?? null

  return (
    <Paper h="100%" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text fw={600} fz="sm">
          Market
        </Text>
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon size="sm" variant="default">
              +
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>add</Menu.Label>
            <Menu.Item onClick={() => dispatch(workbookActions.objectAdded('quote'))}>quote</Menu.Item>
            <Menu.Item onClick={() => dispatch(workbookActions.objectAdded('yieldCurve'))}>flat yield curve</Menu.Item>
            <Menu.Item onClick={() => dispatch(workbookActions.objectAdded('volatility'))}>constant volatility</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <Tooltip label="Everything in the session prices against this date. Changing it is a new session.">
        <TextInput
          size="xs"
          label="evaluation date"
          value={evaluationDate}
          mb="xs"
          onChange={(event) => dispatch(workbookActions.evaluationDateSet(event.currentTarget.value))}
        />
      </Tooltip>

      <ScrollArea style={{ flex: 1, minHeight: 60 }} type="auto">
        <Stack gap={2}>
          {market.map((object) => {
            const objectIssues = issues.filter((issue) => issue.objectId === object.id)
            const errors = objectIssues.filter((issue) => issue.severity === 'error')
            const quote = asQuote(object)
            const isSelected = object.id === selectedId
            return (
              <Group
                key={object.id}
                justify="space-between"
                wrap="nowrap"
                px={6}
                py={3}
                onClick={() => dispatch(workbookActions.selected(isSelected ? null : object.id))}
                style={{
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: isSelected ? 'var(--mantine-color-dark-4)' : 'var(--mantine-color-dark-6)',
                  borderLeft: `2px solid ${errors.length ? 'var(--mantine-color-red-6)' : 'transparent'}`,
                }}
              >
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text fz="xs" ff="monospace" fw={700}>
                    {object.id}
                  </Text>
                  <Text fz="xs" c="dimmed" truncate>
                    {KIND_LABEL[object.kind.case ?? ''] ?? object.kind.case}
                  </Text>
                </Group>
                <Group gap={6} wrap="nowrap">
                  {quote && (
                    <Text fz="xs" ff="monospace">
                      {formatQuote(quote.value, quote.unit)}
                    </Text>
                  )}
                  {errors.length > 0 && (
                    <Tooltip label={errors[0]!.message} multiline w={240}>
                      <Badge size="xs" color="red" variant="light">
                        {errors.length}
                      </Badge>
                    </Tooltip>
                  )}
                  {sessionLive && !built.has(object.id) && (
                    <Tooltip label="Not in SessionOpened.market_ids — rebuild to include it">
                      <Badge size="xs" color="yellow" variant="light">
                        not built
                      </Badge>
                    </Tooltip>
                  )}
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={(event) => {
                      event.stopPropagation()
                      dispatch(workbookActions.objectRemoved(object.id))
                    }}
                  >
                    ×
                  </ActionIcon>
                </Group>
              </Group>
            )
          })}
        </Stack>
      </ScrollArea>

      {selected && (
        <div style={{ marginTop: 8 }}>
          <MarketObjectEditor object={selected} />
        </div>
      )}
    </Paper>
  )
}

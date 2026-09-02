import { useCallback, useState } from 'react'
import { Alert, Badge, Button, Code, Group, List, Paper, Stack, Text } from '@mantine/core'
import { REFERENCE_NPV } from '@/market/handlersSession'
import { WireError } from '@/protocol/errors'
import { closeSession, openSession, priceCurrentTrade } from '@/session/ops'
import { runReferenceCheck } from '@/session/referenceCheck'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { selectIsStale, selectIssues } from '@/store/selectors'

function describe(error: unknown): string {
  if (error instanceof WireError) {
    return `${error.message}${error.fieldPath ? ` — field ${error.fieldPath}` : ''}\n${error.remedy}`
  }
  return error instanceof Error ? error.message : String(error)
}

export function SessionPanel() {
  const dispatch = useAppDispatch()
  const session = useAppSelector((s) => s.session)
  const stale = useAppSelector(selectIsStale)
  const issues = useAppSelector(selectIssues)
  const trade = useAppSelector((s) => s.workbook.trade)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  const errors = issues.filter((issue) => issue.severity === 'error')

  const run = useCallback(
    async (name: string, action: () => Promise<unknown>) => {
      setBusy(name)
      setFailure(null)
      try {
        await action()
      } catch (error) {
        setFailure(describe(error))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  /** Opening is not finished until the price on screen belongs to the session
   *  that is now live. */
  const rebuild = useCallback(async () => {
    await dispatch(openSession())
    await dispatch(priceCurrentTrade())
  }, [dispatch])

  const option = trade.instrument?.kind.case === 'option' ? trade.instrument.kind.value : null
  const strike = option?.payoff?.kind.case === 'plain' ? option.payoff.kind.value.strike : null
  const expiry = option?.exercise?.dates[0]?.form.case === 'iso' ? option.exercise.dates[0].form.value : null

  return (
    <Paper h="100%" style={{ overflowY: 'auto' }}>
      <Group justify="space-between" mb="xs">
        <Text fw={600} fz="sm">
          Session
        </Text>
        <Group gap={6}>
          <Button size="compact-xs" variant="default" disabled={!session.sessionId} onClick={() => void run('close', () => dispatch(closeSession()))}>
            close
          </Button>
          <Button size="compact-xs" variant="default" disabled={!session.sessionId} loading={busy === 'price'} onClick={() => void run('price', () => dispatch(priceCurrentTrade()))}>
            price
          </Button>
          <Button size="compact-xs" loading={busy === 'open'} disabled={errors.length > 0} onClick={() => void run('open', rebuild)}>
            {session.sessionId ? 'rebuild' : 'open session'}
          </Button>
        </Group>
      </Group>

      {stale && (
        <Alert color="yellow" p="xs" mb="xs">
          <Group justify="space-between" wrap="nowrap">
            <Text fz="xs">
              Structure changed. UpdateMarket writes quotes and nothing else, so this needs a new session
              {session.bootstrapSeconds !== null && ` — the last bootstrap took ${(session.bootstrapSeconds * 1000).toFixed(2)} ms`}.
            </Text>
            <Button
              size="compact-xs"
              color="yellow"
              style={{ flexShrink: 0 }}
              loading={busy === 'open'}
              onClick={() => void run('open', rebuild)}
            >
              rebuild
            </Button>
          </Group>
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert color="red" p="xs" mb="xs" title={`${errors.length} problem${errors.length > 1 ? 's' : ''} to fix before opening`}>
          <List size="xs" spacing={2}>
            {errors.slice(0, 5).map((issue, at) => (
              <List.Item key={`${issue.objectId}-${issue.path}-${at}`}>
                <Code fz="xs">{issue.objectId || '(no id)'}{issue.path && `.${issue.path}`}</Code> {issue.message}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}

      <Stack gap={4} mb="sm">
        <Group gap="xs">
          <Badge size="sm" variant="light" color={session.status === 'live' ? 'teal' : session.status === 'lost' ? 'red' : 'gray'}>
            {session.status}
          </Badge>
          {session.sessionId && <Code fz="xs">{session.sessionId}</Code>}
          {session.bootstrapSeconds !== null && (
            <Text fz="xs" c="dimmed">
              bootstrap {(session.bootstrapSeconds * 1000).toFixed(2)} ms · {session.marketIds.length} objects built
            </Text>
          )}
        </Group>
        {session.error && (
          <Text fz="xs" c="red">
            {session.error}
          </Text>
        )}
      </Stack>

      <Text fw={600} fz="sm" mb={4}>
        Trade
      </Text>
      <Text fz="xs" c="dimmed" mb="xs">
        {option ? (
          <>
            European call · strike {strike} · expiry {expiry} · analytic · on S/VOL/RC/QC.
            <br />
            Fixed in M1; the payoff × exercise × underlying × style builder is M2.
          </>
        ) : (
          'no instrument'
        )}
      </Text>

      <Group gap={6}>
        <Button
          size="compact-xs"
          variant="light"
          loading={busy === 'reference'}
          onClick={() =>
            void run('reference', async () => {
              const outcome = await dispatch(runReferenceCheck())
              setReference(
                outcome.matches
                  ? `NPV ${outcome.npv.toFixed(6)} matches HANDLERS.md`
                  : `NPV ${outcome.npv.toFixed(6)}, expected ${REFERENCE_NPV}`,
              )
            })
          }
        >
          run reference check
        </Button>
        {reference && (
          <Text fz="xs" ff="monospace" c={reference.includes('matches') ? 'teal' : 'red'}>
            {reference}
          </Text>
        )}
      </Group>
      <Text fz="xs" c="dimmed" mt={4}>
        Opens the session, bumps spot to 105 on the live graph and prices — the worked example in HANDLERS.md.
      </Text>

      {failure && (
        <Alert color="red" mt="sm" p="xs" styles={{ message: { whiteSpace: 'pre-wrap' } }}>
          {failure}
        </Alert>
      )}
    </Paper>
  )
}

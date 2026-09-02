import { useCallback, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core'
import {
  HANDLERS_CHECK_STEPS,
  runHandlersCheck,
  type CheckStep,
} from '@/session/handlersCheck'
import { WireError } from '@/protocol/errors'
import { client } from '@/store'

const STATUS_COLOR: Record<CheckStep['status'], string> = {
  pending: 'gray',
  running: 'yellow',
  ok: 'teal',
  failed: 'red',
}

/** M0's acceptance harness: drive the HANDLERS.md session and check the NPV it
 *  records. Not a trade builder — that is M2. */
export function AcceptancePanel() {
  const [steps, setSteps] = useState<CheckStep[]>(HANDLERS_CHECK_STEPS)
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const run = useCallback(async () => {
    setRunning(true)
    setFailure(null)
    setSteps(HANDLERS_CHECK_STEPS.map((step) => ({ ...step, status: 'pending', detail: null, ms: null })))
    try {
      await runHandlersCheck(client, (index, patch) => {
        setSteps((current) => current.map((step, at) => (at === index ? { ...step, ...patch } : step)))
      })
    } catch (error) {
      setFailure(
        error instanceof WireError
          ? `${error.code ? `${error.name}: ` : ''}${error.message}${
              error.fieldPath ? ` — field ${error.fieldPath}` : ''
            }\n${error.remedy}`
          : error instanceof Error
            ? error.message
            : String(error),
      )
    } finally {
      setRunning(false)
    }
  }, [])

  return (
    <Paper h="100%" style={{ overflowY: 'auto' }}>
      <Group justify="space-between" mb="xs">
        <Text fw={600} fz="sm">
          M0 acceptance — the HANDLERS.md session
        </Text>
        <Button size="compact-sm" onClick={run} loading={running}>
          Run
        </Button>
      </Group>

      <Stack gap={6}>
        {steps.map((step) => (
          <Group key={step.key} justify="space-between" align="flex-start" wrap="nowrap">
            <Group gap={8} align="flex-start" wrap="nowrap">
              {step.status === 'running' ? (
                <Loader size={12} mt={4} />
              ) : (
                <Badge size="xs" variant="light" color={STATUS_COLOR[step.status]} mt={2}>
                  {step.status}
                </Badge>
              )}
              <div>
                <Text fz="sm" fw={600}>
                  {step.label}
                </Text>
                <Text fz="xs" c="dimmed">
                  {step.note}
                </Text>
                {step.detail && (
                  <Text fz="xs" ff="monospace" c={step.status === 'failed' ? 'red' : 'teal'}>
                    {step.detail}
                  </Text>
                )}
              </div>
            </Group>
            {step.ms !== null && (
              <Text fz="xs" c="dimmed" ff="monospace">
                {step.ms} ms
              </Text>
            )}
          </Group>
        ))}
      </Stack>

      {failure && (
        <Alert color="red" mt="sm" title="Rejected" styles={{ message: { whiteSpace: 'pre-wrap' } }}>
          {failure}
        </Alert>
      )}

      <Text fz="xs" c="dimmed" mt="sm">
        Needs a running backend: <code>./build/ql-backend --port 9111</code>
      </Text>
    </Paper>
  )
}

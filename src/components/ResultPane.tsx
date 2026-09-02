import { Badge, Group, Paper, Stack, Table, Text, Tooltip } from '@mantine/core'
import { REFERENCE_NPV, REFERENCE_TOLERANCE } from '@/market/handlersSession'
import { formatSeconds } from '@/lib/units'
import { useAppSelector } from '@/store/hooks'

export function ResultPane() {
  const latest = useAppSelector((s) => s.results.latest)
  const sessionId = useAppSelector((s) => s.session.sessionId)

  if (!latest) {
    return (
      <Paper h="100%">
        <Text fw={600} fz="sm" mb="xs">
          Result
        </Text>
        <Text fz="xs" c="dimmed">
          No price yet.
        </Text>
      </Paper>
    )
  }

  const matches = Math.abs(latest.npv - REFERENCE_NPV) < REFERENCE_TOLERANCE
  // A rebuild replaces the graph. Until the trade is repriced, this number
  // describes a session that no longer exists.
  const fromAnotherSession = sessionId !== null && latest.sessionId !== sessionId
  // Asked for and not returned. The backend catches QuantLib's "no such
  // result" and leaves the key out, so without this a vega the engine cannot
  // compute is indistinguishable from a vega of zero.
  const returned = new Set(latest.values.map((value) => value.key))
  const absent = latest.requested.filter((key) => !returned.has(key))

  return (
    <Paper h="100%" style={{ overflowY: 'auto' }}>
      <Group justify="space-between" mb="xs">
        <Text fw={600} fz="sm">
          Result
        </Text>
        {fromAnotherSession && (
          <Badge size="xs" variant="light" color="orange">
            from session {latest.sessionId} — reprice
          </Badge>
        )}
        {matches && !fromAnotherSession && (
          <Badge size="xs" variant="light" color="teal">
            matches HANDLERS.md
          </Badge>
        )}
      </Group>

      <Stack gap={2} mb="sm">
        <Text fz={28} fw={700} ff="monospace" lh={1.1} c={fromAnotherSession ? 'dimmed' : undefined}>
          {latest.npv.toFixed(6)}
        </Text>
        <Text fz="xs" c="dimmed">
          NPV {latest.currency && `· ${latest.currency}`}
        </Text>
      </Stack>

      <Table withRowBorders={false}>
        <Table.Tbody>
          {latest.values.map((value) => (
            <Table.Tr key={value.key}>
              <Table.Td c="dimmed">{value.key}</Table.Td>
              <Table.Td ta="right" ff="monospace">
                {value.scalar !== null ? value.scalar.toFixed(6) : value.shape}
              </Table.Td>
            </Table.Tr>
          ))}
          {absent.map((key) => (
            <Table.Tr key={key}>
              <Table.Td c="dimmed">{key}</Table.Td>
              <Table.Td ta="right">
                <Tooltip label="This engine did not publish it. The key is absent, which is not the same as zero." multiline w={240}>
                  <Text fz="xs" c="orange">
                    not supplied
                  </Text>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Stack gap={2} mt="sm">
        <Tooltip label="The engine as it actually ran, echoed by the backend — a price is not comparable without it">
          <Text fz="xs" c="dimmed">
            engine · {latest.engine.toLowerCase().replace(/_/g, ' ')}
          </Text>
        </Tooltip>
        <Text fz="xs" c="dimmed">
          calculated in {formatSeconds(latest.calculationSeconds)}
        </Text>
        {latest.standardError !== null && (
          <Text fz="xs" c="dimmed">
            ± {latest.standardError.toFixed(6)} s.e. over {latest.samples} samples
          </Text>
        )}
      </Stack>
    </Paper>
  )
}

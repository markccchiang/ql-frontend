import { useEffect } from 'react'
import { Grid } from '@mantine/core'
import { MarketPane } from '@/components/MarketPane'
import { QuoteBar } from '@/components/QuoteBar'
import { ResultPane } from '@/components/ResultPane'
import { SessionPanel } from '@/components/SessionPanel'
import { StatusBar } from '@/components/StatusBar'
import { FrameInspector } from '@/devtools/FrameInspector'
import { client } from '@/store'
import { useAppSelector } from '@/store/hooks'

export function App() {
  const inspectorOpen = useAppSelector((s) => s.wire.open)

  useEffect(() => {
    // A failed connect is a normal state here, not an error: the backend is a
    // local daemon that may simply not be running.
    void client.connect().catch(() => undefined)
    return () => client.close()
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <StatusBar />
      <Grid
        gutter="xs"
        p="xs"
        style={{ flex: 1, minHeight: 0 }}
        align="stretch"
        styles={{ inner: { height: '100%' } }}
      >
        <Grid.Col span={4} style={{ minHeight: 0 }}>
          <MarketPane />
        </Grid.Col>
        <Grid.Col span={5} style={{ minHeight: 0 }}>
          <SessionPanel />
        </Grid.Col>
        <Grid.Col span={3} style={{ minHeight: 0 }}>
          <ResultPane />
        </Grid.Col>
      </Grid>
      <QuoteBar />
      {inspectorOpen && <FrameInspector />}
    </div>
  )
}

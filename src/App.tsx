import {useEffect} from "react";
import {Grid} from "@mantine/core";
import {MarketPane} from "@/components/MarketPane";
import {QuoteBar} from "@/components/QuoteBar";
import {ScenarioPanel} from "@/components/scenario/ScenarioPanel";
import {ResultPane} from "@/components/ResultPane";
import {SessionPanel} from "@/components/SessionPanel";
import {TradeBuilder} from "@/components/trade/TradeBuilder";
import {StatusBar} from "@/components/StatusBar";
import {FrameInspector} from "@/devtools/FrameInspector";
import {client} from "@/store";
import {useAppSelector} from "@/store/hooks";

export function App() {
    const inspectorOpen = useAppSelector(s => s.wire.open);
    const sweepOpen = useAppSelector(s => s.scenario.open);

    useEffect(() => {
        // A failed connect is a normal state here, not an error: the backend is a
        // local daemon that may simply not be running.
        void client.connect().catch(() => undefined);
        return () => client.close();
    }, []);

    return (
        <div style={{display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden"}}>
            <StatusBar />
            <Grid gutter="xs" p="xs" style={{flex: 1, minHeight: 0, overflow: "hidden"}} align="stretch" styles={{inner: {height: "100%"}}}>
                <Grid.Col span={4} style={{height: "100%", minHeight: 0}}>
                    <MarketPane />
                </Grid.Col>
                {/* The centre column is the only one tall enough to need its own
            scroller; letting it grow instead scrolls the whole window and
            moves every control out from under the pointer. */}
                <Grid.Col span={5} style={{height: "100%", minHeight: 0, overflowY: "auto"}}>
                    <SessionPanel />
                    <TradeBuilder />
                </Grid.Col>
                <Grid.Col span={3} style={{height: "100%", minHeight: 0}}>
                    <ResultPane />
                </Grid.Col>
            </Grid>
            {sweepOpen && <ScenarioPanel />}
            <QuoteBar />
            {inspectorOpen && <FrameInspector />}
        </div>
    );
}

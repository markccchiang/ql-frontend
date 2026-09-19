import {lazy, Suspense, useEffect} from "react";
import {Grid} from "@mantine/core";
import {notifications} from "@mantine/notifications";

import {MarketPane} from "@/components/MarketPane";
import {QuoteBar} from "@/components/QuoteBar";
import {ResultPane} from "@/components/ResultPane";
import {SessionPanel} from "@/components/SessionPanel";
import {StatusBar} from "@/components/StatusBar";
import {TabBar} from "@/components/TabBar";
import {TradeBuilder} from "@/components/trade/TradeBuilder";
import {WorkbookBar} from "@/components/WorkbookBar";
import {FrameInspector} from "@/devtools/FrameInspector";
import {client} from "@/store";
import {useAppSelector} from "@/store/hooks";
import {takeLoadProblem} from "@/store/persistence";

/** The sweep, Monte Carlo and compare panels, and uPlot with them, are only
 *  needed once a bottom tab is opened. */
const BottomPanel = lazy(async () => ({default: (await import("@/components/BottomPanel")).BottomPanel}));

export const App = () => {
    const isInspectorOpen = useAppSelector(s => s.wire.open);
    const bottomPanel = useAppSelector(s => s.ui.bottomPanel);

    useEffect(() => {
        // A failed connect is a normal state here, not an error: the backend is a
        // local daemon that may simply not be running.
        void client.connect().catch(() => undefined);
        return () => client.close();
    }, []);

    useEffect(() => {
        // Said once, and not silently: the page came up on the seed instead of
        // the saved workbooks, and the user needs to know where those went.
        const problem = takeLoadProblem();
        if (problem) notifications.show({color: "yellow", title: "The saved workbooks could not be read", message: problem, autoClose: false});
    }, []);

    return (
        <div style={{display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden"}}>
            <StatusBar />
            <TabBar />
            <WorkbookBar />
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
            {bottomPanel !== null && (
                <Suspense fallback={null}>
                    <BottomPanel />
                </Suspense>
            )}
            <QuoteBar />
            {isInspectorOpen && <FrameInspector />}
        </div>
    );
};

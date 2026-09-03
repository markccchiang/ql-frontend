import {Paper, Tabs} from "@mantine/core";

import {useAppDispatch, useAppSelector} from "@/store/hooks";
import {uiActions} from "@/store/uiSlice";

import {ComparePanel} from "./compare/ComparePanel";
import {McPanel} from "./mc/McPanel";
import {ScenarioPanel} from "./scenario/ScenarioPanel";

/** One strip, two long-running views.
 *
 *  A sweep and a batched Monte Carlo are both a chart of a calculation in
 *  progress; giving each its own edge of the screen would cost the market and
 *  trade panes height for no reason.
 */
export const BottomPanel = () => {
    const dispatch = useAppDispatch();
    const bottomPanel = useAppSelector(state => state.ui.bottomPanel);

    return (
        <Paper p="xs" radius={0} style={{borderLeft: 0, borderRight: 0, borderBottom: 0, height: 280}}>
            <Tabs value={bottomPanel} onChange={value => dispatch(uiActions.bottomPanelShown(value as "sweep" | "mc" | "compare"))} variant="outline" style={{height: "100%", display: "flex", flexDirection: "column"}}>
                <Tabs.List>
                    <Tabs.Tab value="sweep">sweep</Tabs.Tab>
                    <Tabs.Tab value="mc">monte carlo</Tabs.Tab>
                    <Tabs.Tab value="compare">compare</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="sweep" pt="xs" style={{flex: 1, minHeight: 0}}>
                    <ScenarioPanel />
                </Tabs.Panel>
                <Tabs.Panel value="mc" pt="xs" style={{flex: 1, minHeight: 0}}>
                    <McPanel />
                </Tabs.Panel>
                <Tabs.Panel value="compare" pt="xs" style={{flex: 1, minHeight: 0}}>
                    <ComparePanel />
                </Tabs.Panel>
            </Tabs>
        </Paper>
    );
};

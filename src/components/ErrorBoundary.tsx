import {Component, type ErrorInfo, type ReactNode} from "react";
import {Alert, Button, Code, Group, Stack, Text} from "@mantine/core";

import {store} from "@/store";
import {downloadWorkbook} from "@/store/exportWorkbook";
import {clearWorkbook} from "@/store/persistence";

interface ErrorBoundaryState {
    error: Error | null;
}

/** The last thing between a render error and a blank page.
 *
 *  Without it, one component throwing while it renders unmounts the whole app,
 *  and the user is left with an empty window and no idea whether their work
 *  survived. It did -- the workbook is in the store and in local storage -- and
 *  this says so, shows what failed, and offers the ways out in order of how
 *  little they cost: keep a copy, reload, and only if reloading brings the same
 *  failure back, start again from the seed.
 */
export class ErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
    state: ErrorBoundaryState = {error: null};

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return {error};
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("ql-frontend: a component failed to render", error, info.componentStack);
    }

    render() {
        const {error} = this.state;
        if (!error) return this.props.children;

        return (
            <Stack p="xl" maw={720}>
                <Alert color="red" title="Part of the page failed to draw">
                    <Text fz="sm">Your workbook is still here: it is saved in this browser and comes back when the page reloads. Save a copy first if you want one somewhere safer.</Text>
                    <Code block mt="sm">
                        {error.message}
                    </Code>
                    <Group gap="xs" mt="md">
                        <Button size="xs" variant="default" onClick={() => downloadWorkbook(store.getState().workbook)}>
                            Save a Copy
                        </Button>
                        <Button size="xs" onClick={() => window.location.reload()}>
                            Reload
                        </Button>
                        <Button
                            size="xs"
                            variant="subtle"
                            color="red"
                            onClick={() => {
                                clearWorkbook();
                                window.location.reload();
                            }}
                        >
                            Start from the Seed
                        </Button>
                    </Group>
                    <Text fz="xs" c="dimmed" mt="xs">
                        Start from the Seed forgets every saved workbook, for when reloading brings this failure straight back.
                    </Text>
                </Alert>
            </Stack>
        );
    }
}

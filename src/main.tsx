import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {Provider} from "react-redux";
import {MantineProvider} from "@mantine/core";
import {Notifications} from "@mantine/notifications";

import {ErrorBoundary} from "@/components/ErrorBoundary";

import {App} from "./App";
import {store} from "./store";
import {cssVariablesResolver, theme} from "./theme";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Provider store={store}>
            <MantineProvider theme={theme} defaultColorScheme="dark" cssVariablesResolver={cssVariablesResolver}>
                <Notifications position="top-right" />
                <ErrorBoundary>
                    <App />
                </ErrorBoundary>
            </MantineProvider>
        </Provider>
    </StrictMode>
);

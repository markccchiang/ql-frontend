import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {Provider} from "react-redux";
import {MantineProvider} from "@mantine/core";

import {App} from "./App";
import {store} from "./store";
import {cssVariablesResolver, theme} from "./theme";

import "@mantine/core/styles.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Provider store={store}>
            <MantineProvider theme={theme} defaultColorScheme="dark" cssVariablesResolver={cssVariablesResolver}>
                <App />
            </MantineProvider>
        </Provider>
    </StrictMode>
);

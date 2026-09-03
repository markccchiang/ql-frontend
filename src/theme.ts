import {createTheme, type CSSVariablesResolver} from "@mantine/core";

/** Dark by default and dense: this is a tool people stare at all day
 *  (PLAN.md §7.12). */
export const theme = createTheme({
    primaryColor: "teal",
    // White on teal-8 is 3.94:1 at the sizes this app uses its buttons.
    primaryShade: {light: 6, dark: 9},
    defaultRadius: "sm",
    fontFamilyMonospace: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    components: {
        Table: {defaultProps: {fz: "xs", verticalSpacing: 4}},
        Paper: {defaultProps: {withBorder: true, p: "sm"}}
    }
});

/** Mantine's default dimmed grey does not reach 4.5:1 on these surfaces, and
 *  dimmed is what nearly every explanation in this app is written in — the
 *  sentence saying why an engine is closed is no use if it cannot be read.
 *  Raised to a grey that passes AA on both the page and the panels.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
    variables: {},
    light: {},
    dark: {"--mantine-color-dimmed": "var(--mantine-color-dark-1)"}
});

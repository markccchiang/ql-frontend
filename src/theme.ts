import { createTheme } from '@mantine/core'

/** Dark by default and dense: this is a tool people stare at all day
 *  (PLAN.md §7.12). */
export const theme = createTheme({
  primaryColor: 'teal',
  defaultRadius: 'sm',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  components: {
    Table: { defaultProps: { fz: 'xs', verticalSpacing: 4 } },
    Paper: { defaultProps: { withBorder: true, p: 'sm' } },
  },
})

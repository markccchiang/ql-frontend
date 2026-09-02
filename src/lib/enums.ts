export interface EnumOption {
  value: string
  label: string
}

/** Options for a generated protobuf enum, with the reserved zero left out.
 *
 *  Zero is *_UNSPECIFIED everywhere and the backend rejects it, so it must not
 *  be offerable. A control with nothing chosen shows a placeholder instead —
 *  which is the honest rendering of an unset field.
 */
export function enumOptions(source: Record<string, string | number>, omit: string[] = []): EnumOption[] {
  return Object.entries(source)
    .filter(([name, value]) => typeof value === 'number' && value !== 0 && !omit.includes(name))
    .map(([name, value]) => ({ value: String(value), label: humanize(name) }))
}

export function humanize(name: string): string {
  return name.toLowerCase().replace(/_/g, ' ')
}

// The units a length field's menu offers first (the user's real-use audit, item 5.2/A3.33): the ones a person reaches
// for. The property's keywords and every other unit wait behind the menu's "More units", so the list a person opens
// stays short (Font size covers some fifty units; ten items is the most it may show before "More units"). One owner:
// the field's menu (src/editor/shell/field.tsx) draws what this reads, and nothing else lists units.
const COMMON_UNITS: readonly string[] = ['px', '%', 'em', 'rem', 'vw', 'vh', 'ch'];

// The units a property's menu shows at once, and the ones behind "More units": the common ones it offers, then the
// rest. The keywords a property takes are values the field itself suggests, so they are offered with the rest.
export function unitMenu(units: readonly string[]): { readonly common: readonly string[]; readonly more: readonly string[] } {
  const common = COMMON_UNITS.filter((unit) => units.includes(unit));
  return { common, more: units.filter((unit) => !common.includes(unit)) };
}

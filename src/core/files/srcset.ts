// The HTML srcset candidate grammar: a URL can contain commas (notably a data URL), while descriptors end
// at a comma outside parentheses. Rewrite only URL spans; keep descriptors and whitespace byte for byte.
export function rewriteSrcsetUrls(value: string, rewrite: (url: string) => string): string {
  const replacements: { readonly start: number; readonly end: number; readonly value: string }[] = [];
  const space = (character: string | undefined): boolean => character !== undefined && /[\t\n\f\r ]/.test(character);
  let at = 0;
  while (at < value.length) {
    while (at < value.length && (space(value[at]) || value[at] === ',')) at += 1;
    const start = at;
    while (at < value.length && !space(value[at])) at += 1;
    let end = at;
    while (end > start && value[end - 1] === ',') end -= 1;
    if (end > start) replacements.push({ start, end, value: rewrite(value.slice(start, end)) });
    if (end === at) {
      let depth = 0;
      while (at < value.length) {
        const character = value[at];
        at += 1;
        if (character === '(') depth += 1;
        else if (character === ')') depth = Math.max(0, depth - 1);
        else if (character === ',' && depth === 0) break;
      }
    }
  }
  let result = value;
  for (const one of replacements.reverse()) result = result.slice(0, one.start) + one.value + result.slice(one.end);
  return result;
}

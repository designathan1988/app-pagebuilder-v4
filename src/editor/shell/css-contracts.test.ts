// Families FR1, CL2 and TY1 of the code audit (2026-10-04, second reading), read from the stylesheets as the browser
// cascades them (main.tsx loads shell.css before canvas.css, so a later rule of the same weight wins):
//  - FR1: the code pane's rule editor wrote outline: none, which beat the one focus ring (:focus-visible): reached by
//    the keyboard, it showed no focus at all;
//  - CL2: the selection marquee was drawn with the class of Edit on canvas's spacing bands, whose later rule hatched it
//    and made it take the pointer;
//  - TY1: the shell gave the interface's type to buttons and inputs only, so a select and a textarea kept the browser's
//    own font (13.333 px; a textarea in monospace).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const css = (file: string) => fs.readFileSync(`src/editor/shell/${file}`, 'utf8');
// the declarations of the rule written with exactly this selector, or null
const rule = (text: string, selector: string): string | null => {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim() === `${selector} {`);
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  return rest.slice(0, rest.findIndex((line) => line.trim() === '}')).join('\n');
};

describe('the shell\'s stylesheets keep their contracts (FR1, CL2, TY1)', () => {
  it('lets the focus ring show on the code pane\'s editor', () => {
    const editor = rule(css('canvas.css'), '.code-pane__editor');
    expect(editor).not.toBeNull();
    expect(editor ?? '').not.toMatch(/outline:\s*none/);
  });
  it('draws the marquee with a class of its own', () => {
    expect(fs.readFileSync('src/editor/canvas/chrome.tsx', 'utf8')).toContain('className="chrome__marquee" data-chrome="band"');
    expect(rule(css('canvas.css'), '.chrome__marquee')).not.toBeNull();
  });
  it('gives selects and textareas the interface\'s type', () => {
    expect(css('shell.css')).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{\s*font: inherit;/);
  });
});

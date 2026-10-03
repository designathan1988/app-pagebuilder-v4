// The compiler's ports as the app gives them, for the module's tests: the track list owner and the manifest's own
// property vocabulary.
import { manifest, tracksToValue } from '../../../editor/host.ts';
import type { CompilerPorts } from '../compiler/compile.ts';
import { propertyVocabulary } from '../adapters/properties.ts';
import type { Box, LayoutIntent, Region } from '../intent/model.ts';
import { emptyIntent, region } from '../intent/model.ts';
import { solve } from '../constraints/solve.ts';

export const PORTS: CompilerPorts = {
  tracks: tracksToValue,
  properties: propertyVocabulary([...manifest.properties.properties, ...manifest.properties.composites]),
};

// The manifest's id of a property by its role, for assertions that read compiled declarations.
export const property = (role: string): string => {
  const id = PORTS.properties[role];
  if (id === undefined) throw new Error(`no property for ${role}`);
  return id;
};

// A composition of regions drawn at these boxes (ids r1, r2… in order), solved.
export function drawn(width: number, height: number, boxes: readonly Box[], change: (r: Region, i: number) => Region = (r) => r): LayoutIntent {
  return solve({ ...emptyIntent(width, height), regions: boxes.map((b, i) => change({ ...region(`r${i + 1}`, b, `Region ${i + 1}`) }, i)) }).graph;
}

// When a shortcut runs, part of the keymap owner (PRODUCT.md §5): its command is
// built, and its door's feature is the feature that introduces the command or is registered as built (the feature
// table, src/app/features.ts). A key has no drawing to say "not available yet", so the shortcut of a feature still to
// come does not run, while its command already runs through the doors of the feature that introduced it (the gradient
// editor's stop keys wait for the gradient editor, though props-background built the command they run). The keymap
// decides with this function, and the door census (tests/e2e/census.spec.ts) and the scenario runner import the same
// one, so it is pure: it runs in the editor and in Node.
export interface ShortcutFacts {
  readonly command: string;
  // the feature that introduces the command (its manifest `introducedBy`)
  readonly introducedBy: string;
  // the door's own feature
  readonly feature: string;
}

export function shortcutRuns(door: ShortcutFacts, built: (command: string) => boolean, featureBuilt: (feature: string) => boolean): boolean {
  return built(door.command) && (door.feature === door.introducedBy || featureBuilt(door.feature));
}

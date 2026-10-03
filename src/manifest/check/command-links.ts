// Doors, commands and features meet: a door names a command, a command has a door, a feature lists what it introduces,
// nothing needs what comes later, a spec section exists.
import type { CheckContext } from './context.ts';

export function commandLinksRules(ctx: CheckContext) {
  const { p, report, features, featureIndex, commands, commandById, doors, input } = ctx;
  // ---- door-unknown-command: a door reference, in a scenario's doors or its steps, names a command, then one of its
  // doors
  const checkDoorRef = (doorRef: string, file: string, path: string) => {
    const [commandPart = '', doorPart = ''] = doorRef.split('#');
    const command = commandById.get(commandPart);
    if (!command) report('door-unknown-command', file, path, `door "${doorRef}" points to unknown command "${commandPart}"`);
    else if (!command.entryPoints.some((d) => d.id === doorPart)) report('door-unknown-command', file, path, `command ${commandPart} has no door "${doorPart}"`);
  };
  for (const f of features) {
    for (const [si, s] of f.feature.scenarios.entries()) {
      s.doors.forEach((doorRef, di) => checkDoorRef(doorRef, f.file, `${f.path}.scenarios[${si}].doors[${di}]`));
      s.steps.forEach((step, ti) => checkDoorRef(step.door, f.file, `${f.path}.scenarios[${si}].steps[${ti}].door`));
    }
  }

  // ---- command-without-door
  for (const c of commands) {
    if (c.command.entryPoints.length === 0) report('command-without-door', c.file, `${c.path}.entryPoints`, `command ${c.command.id} has no door`);
  }

  // ---- feature-command-link: the feature that introduces a command, and the feature of each door, list that command
  const featureById = new Map(features.map((f) => [f.feature.id, f]));
  for (const c of commands) {
    const introducer = featureById.get(c.command.introducedBy);
    if (introducer && !introducer.feature.commands.includes(c.command.id)) {
      report('feature-command-link', c.file, `${c.path}.introducedBy`, `feature ${introducer.feature.id} introduces ${c.command.id} but does not list it in its commands`);
    }
  }
  for (const { file, path, command, door } of doors) {
    const owner = featureById.get(door.feature);
    if (owner && !owner.feature.commands.includes(command.id)) {
      report('feature-command-link', file, `${path}.feature`, `door ${command.id}#${door.id} belongs to feature ${owner.feature.id}, which does not list ${command.id}`);
    }
  }

  // ---- order: nothing needs what is introduced later
  for (const f of features) {
    for (const [i, id] of f.feature.commands.entries()) {
      const command = commandById.get(id);
      const at = command ? featureIndex.get(command.introducedBy) : undefined;
      if (at !== undefined && at > f.index) {
        report('order', f.file, `${f.path}.commands[${i}]`, `feature ${f.feature.id} (#${f.index + 1}) needs ${id}, introduced later by ${command?.introducedBy} (#${at + 1})`);
      }
    }
    for (const [i, id] of f.feature.dependsOn.entries()) {
      const at = featureIndex.get(id);
      if (at !== undefined && at >= f.index) {
        report('order', f.file, `${f.path}.dependsOn[${i}]`, `feature ${f.feature.id} (#${f.index + 1}) depends on ${id} (#${at + 1}), which is not earlier`);
      }
    }
  }
  for (const { file, path, command, door } of doors) {
    const doorAt = featureIndex.get(door.feature);
    const commandAt = featureIndex.get(command.introducedBy);
    if (doorAt !== undefined && commandAt !== undefined && doorAt < commandAt) {
      report('order', file, `${path}.feature`, `door ${command.id}#${door.id} arrives with ${door.feature} (#${doorAt + 1}), before its command is introduced by ${command.introducedBy} (#${commandAt + 1})`);
    }
  }

  // ---- spec-missing: a reference names a file that exists and a section of it that exists
  const sectionsOf = (file: string): readonly string[] =>
    String(input.documents[file] ?? '')
      .split('\n')
      .filter((line) => /^## /.test(line))
      .map((line) => line.slice(3).trim());
  const checkSpecRef = (ref: string, file: string, path: string) => {
    const [target = '', anchor = ''] = ref.split('#');
    if (!input.fileExists(target)) {
      report('spec-missing', file, path, `spec file ${target} does not exist`);
      return;
    }
    // a file that is not read as a manifest file (a document) cannot be searched for its sections here
    const sections = sectionsOf(target);
    if (sections.length > 0 && !sections.includes(anchor)) report('spec-missing', file, path, `${target} has no section #${anchor}`);
  };
  for (const f of features) checkSpecRef(f.feature.spec, f.file, `${f.path}.spec`);
  for (const [i, c] of p.interactions.constants.entries()) checkSpecRef(c.source, 'interactions.json', `constants[${i}].source`);
  for (const [i, g] of p.interactions.gestures.entries()) checkSpecRef(g.source, 'interactions.json', `gestures[${i}].source`);
}

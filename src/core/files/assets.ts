// Storing an image file and placing it (INVENTORY.md, owners; spec explorer-assets-use; the user's real-use
// audit, 7.3): assets.insertImageFile stores one image file in the project's files (`src/core/files/files.ts`, the
// tree's owner) and places an Image that uses it in the document — at the drop position (parent + index), or, when the
// drop landed on an image (`replace`), as that image's source. The drop position's grammar is element.insert's: the
// same placementRefusal, the same locked parent.
import { message, registerHandler } from '../commands/registry.ts';
import type { DocNode, NodeId } from '../document/model.ts';
import { locate } from '../document/model.ts';
import { placementRefusal } from '../elements/content-model.ts';
import { lockRefusal } from '../nodes/flags.ts';
import { placement } from '../structure/insert.ts';
import { newElement, nodeMaker } from '../structure/node-maker.ts';
import { addRecords, fileList, recordsFor, unsupported } from './files.ts';

// the element type a dropped file is placed as, and the element a drop replaces the source of
const IMAGE_TYPE = 'image';

export const insertImageFileCommand = registerHandler('assets.insertImageFile', ({ state, ids, rules, words }, { file, parent, index, replace }) => {
  const list = fileList(file).filter((f) => f !== null && typeof f === 'object');
  const first = list[0];
  if (first === undefined) throw new Error('assets.insertImageFile: no file');
  const wrong = unsupported(list);
  if (wrong !== undefined) return { kind: 'refused' as const, message: message('status.files.unsupportedType', { name: wrong.name }) };
  const records = recordsFor(state.document, list, undefined);
  const stored = records[0];
  if (stored === undefined) throw new Error('assets.insertImageFile: no file stored');
  const held = addRecords(state.document, records);
  // a drop on an image replaces its source (the user's real-use audit, 7.3): the file is stored, the image points at it
  const target = replace === undefined || replace === null ? null : locate(state.document, replace as NodeId);
  if (target !== null) {
    if (target.node.type !== IMAGE_TYPE) {
      return { kind: 'refused' as const, message: message('status.assets.notImage', { name: target.node.name }) };
    }
    return {
      kind: 'change' as const,
      patches: [...held, { op: 'add' as const, path: [...target.path, 'attributes', 'src'], value: stored.path }],
      selection: [target.node.id],
      message: message('status.assets.replaced', { name: target.node.name, file: stored.path }),
    };
  }
  const at = placement(state, state.selection, rules, parent as NodeId | undefined, index === undefined ? undefined : Number(index));
  if (at === null) throw new Error(`assets.insertImageFile: the document has no node ${String(parent)}`);
  const receiver = at.parent.node;
  const locked = lockRefusal(state.document, receiver.id, 'status.locked.insert');
  if (locked !== null) return { kind: 'refused' as const, message: locked };
  // the element as element.insert makes one (its default styles and text), with the file as its source
  const made = newElement(nodeMaker(state.document, rules, ids, words), IMAGE_TYPE);
  const node: DocNode = { ...made, attributes: { ...made.attributes, src: stored.path } };
  const refused = placementRefusal(state.document, rules, receiver.id, [node]);
  if (refused !== null) return { kind: 'refused' as const, message: refused };
  return {
    kind: 'change' as const,
    patches: [...held, { op: 'add' as const, path: [...at.parent.path, 'children', at.index], value: node }],
    selection: [node.id],
    message: message('status.placed', { element: node.name, parent: receiver.name, position: at.index + 1, count: receiver.children.length + 1 }),
  };
});

// The plain JavaScript of a project's interactions (INVENTORY.md, owners; group 18, spec export-events-js):
// the one writer of the site's `js/interactions.js`, read by the export (core/export/export.ts, which puts it in the
// archive and links it from the pages that use interactions) and by the preview (previewPage, which runs the same
// script). No framework, no inline handler, no editor id and no data attribute: every element is addressed by the BEM
// class the export gives it or by the person's own `id` attribute, the class the exporter wrote for the element.
//  - A trigger: click; hover (pointerenter, and pointerleave for the actions that reverse: show and hide); entering
//    the screen (an IntersectionObserver, once); the page loading (the script runs deferred, so the page is parsed); a
//    form's submit (the browser's own submit, never navigated away).
//  - An action: show and hide (the hidden property the editor's eye and a hidden element's export agree on); toggle a
//    class; play an animation (the class rule the export writes beside its @keyframes, restarted when it fires again);
//    scroll to an element; open a link (a new tab like the element's own link, or the same one).
import { walk, type DocNode, type DocumentJson, type Interaction, type NodeId } from '../document/model.ts';
import { actionTarget, firesOnce, interactionsOf, needsAddress, needsAnimation, needsTarget } from './interactions.ts';
import { playedClassName } from '../animation/animation.ts';

// The saved template trees predate runtime metadata. Recognise their semantic structure so existing projects and
// newly inserted templates behave alike without changing the model or its palette insertion contract.
export const isModalTemplate = (node: DocNode): boolean =>
  node.tag === 'dialog' && node.children.some((child) => child.tag === 'button');
export const isTabsTemplate = (node: DocNode): boolean =>
  node.tag === 'div' && node.children[0]?.tag === 'nav' && node.children[0].children.length >= 2 &&
  node.children[0].children.every((child) => child.tag === 'button') && node.children[1]?.tag === 'div';
export const pageNeedsScript = (tree: DocNode): boolean =>
  [...walk(tree)].some((node) => interactionsOf(node).length > 0 || isModalTemplate(node) || isTabsTemplate(node));

const tabsRuntime = (selector: string): string => `each(${quoted(selector)}, function (root) {
  var nav = root.querySelector(':scope > nav');
  var firstPanel = root.querySelector(':scope > div');
  if (!nav || !firstPanel) return;
  var tabs = nav.querySelectorAll(':scope > button');
  if (tabs.length < 2) return;
  nav.setAttribute('role', 'tablist');
  var freshId = function (kind) {
    var number = 1, id;
    do { id = 'builder-' + kind + '-' + number; number += 1; } while (document.getElementById(id));
    return id;
  };
  var panels = [firstPanel];
  firstPanel.setAttribute('role', 'tabpanel');
  for (var i = 1; i < tabs.length; i += 1) {
    var panel = document.createElement('div');
    panel.setAttribute('role', 'tabpanel');
    var placeholder = document.createElement('p');
    placeholder.textContent = tabs[i].textContent || '';
    panel.appendChild(placeholder);
    panel.hidden = true;
    panels[i - 1].after(panel);
    panels.push(panel);
  }
  var select = function (index, focus) {
    for (var j = 0; j < tabs.length; j += 1) {
      var active = j === index;
      tabs[j].setAttribute('aria-selected', String(active));
      tabs[j].tabIndex = active ? 0 : -1;
      panels[j].hidden = !active;
    }
    if (focus) tabs[index].focus();
  };
  for (var k = 0; k < tabs.length; k += 1) {
    tabs[k].setAttribute('role', 'tab');
    if (!tabs[k].id) tabs[k].id = freshId('tab');
    if (!panels[k].id) panels[k].id = freshId('panel');
    tabs[k].setAttribute('aria-controls', panels[k].id);
    panels[k].setAttribute('aria-labelledby', tabs[k].id);
    (function (index) {
      tabs[index].addEventListener('click', function (event) { event.preventDefault(); select(index, false); });
      tabs[index].addEventListener('keydown', function (event) {
        var next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        select(next, true);
      });
    })(k);
  }
  select(0, false);
});`;

// One selector per node, as the export writes it: the class the export gave the element (the export gives every element
// an interaction addresses a class of its own), or the person's own `id` attribute.
export type SelectorOf = (node: NodeId) => string;

const quoted = (text: string): string => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

// what an interaction's action does, as JavaScript statements, on the element it acts on: the target it names, else the
// element itself (actionTarget; an action on its own element wrote `if (target)` with no target declared, which throws
// in the script's strict mode, so an animation an element plays on itself never played in the exported site)
function actionJs(node: DocNode, interaction: Interaction, selectorOf: SelectorOf): string | null {
  // an action on the element itself acts on the element the event fired on (`el`): elements that share a class (a
  // component's instances, an interaction that applies to a class) each act on their own (the audit's EV1)
  const find = !needsTarget(interaction.action) ? null : interaction.target === undefined ? 'var target = el;' : `var target = document.querySelector(${quoted(selectorOf(actionTarget(node, interaction)))});`;
  const act: string | null = (() => {
    if (interaction.action === 'show') return `if (target) target.hidden = false;`;
    if (interaction.action === 'hide') return `if (target) target.hidden = true;`;
    if (interaction.action === 'toggle-class')
      return interaction.className === undefined ? null : `if (target) target.classList.toggle(${quoted(interaction.className)});`;
    if (needsAnimation(interaction.action)) {
      if (interaction.animation === undefined) return null;
      // the class rule the export writes next to the @keyframes; taken off and on again so a second firing plays anew
      const name = playedClassName(interaction.animation);
      return `if (target) { target.classList.remove(${quoted(name)}); void target.offsetWidth; target.classList.add(${quoted(name)}); }`;
    }
    if (interaction.action === 'scroll-to') return `if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });`;
    if (needsAddress(interaction.action)) {
      if (interaction.address === undefined) return null;
      return interaction.newTab === true
        ? `window.open(${quoted(interaction.address)}, '_blank', 'noopener,noreferrer');`
        : `window.location.assign(${quoted(interaction.address)});`;
    }
    return null;
  })();
  if (act === null) return null;
  return find === null ? act : `${find} ${act}`;
}

// the action a hover's leave runs, where the action has one (show and hide are each other's)
function reverseJs(node: DocNode, interaction: Interaction, selectorOf: SelectorOf): string | null {
  if (interaction.target === undefined) return null;
  const other = interaction.action === 'show' ? 'hide' : interaction.action === 'hide' ? 'show' : null;
  return other === null ? null : actionJs(node, { ...interaction, action: other }, selectorOf);
}

// one interaction of one element, as the statement that wires it. Its Options: an action that waits runs in a
// setTimeout of its delay; an interaction that fires once runs its action the first time only (a flag per element: a
// submit is still kept on the page every time, a hover's leave runs once after its enter), and one that enters the
// screen every time runs each time the element comes back into view.
function wiringJs(node: DocNode, interaction: Interaction, triggerSelectorOf: SelectorOf, selectorOf: SelectorOf): string | null {
  const action = actionJs(node, interaction, selectorOf);
  if (action === null) return null;
  const delay = interaction.delay ?? 0;
  const later = (js: string): string => (delay > 0 ? `setTimeout(function () { ${js} }, ${String(delay)});` : js);
  const act = later(action);
  const once = firesOnce(interaction);
  const flag = once ? 'var fired = false; ' : '';
  const guard = once ? 'if (fired) return; fired = true; ' : '';
  const selector = triggerSelectorOf(node.id as NodeId);
  if (interaction.trigger === 'click') return `each(${quoted(selector)}, function (el) { ${flag}el.addEventListener('click', function () { ${guard}${act} }); });`;
  if (interaction.trigger === 'hover') {
    const reverse = reverseJs(node, interaction, selectorOf);
    const leave = reverse === null ? null : later(reverse);
    const leaveGuard = once ? 'if (!fired || left) return; left = true; ' : '';
    return `each(${quoted(selector)}, function (el) { ${flag}${once && leave !== null ? 'var left = false; ' : ''}el.addEventListener('pointerenter', function () { ${guard}${act} });${leave === null ? '' : ` el.addEventListener('pointerleave', function () { ${leaveGuard}${leave} });`} });`;
  }
  if (interaction.trigger === 'scroll-into-view') {
    if (once)
      return `each(${quoted(selector)}, function (el) {\n    var fired = false;\n    var observer = new IntersectionObserver(function (entries) {\n      for (var i = 0; i < entries.length; i += 1) {\n        if (!entries[i].isIntersecting || fired) continue;\n        fired = true;\n        observer.disconnect();\n        ${act}\n      }\n    }, { threshold: 0.5 });\n    observer.observe(el);\n  });`;
    return `each(${quoted(selector)}, function (el) {\n    var inside = false;\n    var observer = new IntersectionObserver(function (entries) {\n      for (var i = 0; i < entries.length; i += 1) {\n        var now = entries[i].isIntersecting;\n        if (now && !inside) { ${act} }\n        inside = now;\n      }\n    }, { threshold: 0.5 });\n    observer.observe(el);\n  });`;
  }
  if (interaction.trigger === 'page-load') return `each(${quoted(selector)}, function (el) { ${act} });`;
  if (interaction.trigger === 'form-submit') return `each(${quoted(selector)}, function (el) { ${flag}el.addEventListener('submit', function (event) { event.preventDefault(); ${guard}${act} }); });`;
  return null;
}

// The whole script of a project's interactions: the pages' elements in document order, one block per interaction.
// Null while the project holds none (a site without interactions gets no file and no script link).
export function interactionsJs(document: DocumentJson, selectorOf: SelectorOf): string | null {
  const blocks: string[] = [];
  // Component instances can intentionally share a generated class. One binding covers every matching instance.
  const modalSelectors = new Set<string>();
  const tabsSelectors = new Set<string>();
  for (const page of document.pages) {
    for (const node of walk(page.tree)) {
      const selector = selectorOf(node.id as NodeId);
      if (isModalTemplate(node) && !modalSelectors.has(selector)) {
        modalSelectors.add(selector);
        blocks.push(`each(${quoted(selector)}, function (dialog) {
  var closer = dialog.querySelector(':scope > button');
  if (!closer) return;
  var opener = document.createElement('button');
  opener.type = 'button';
  opener.textContent = dialog.querySelector(':scope > h2')?.textContent?.trim() || 'Open dialog';
  dialog.before(opener);
  opener.addEventListener('click', function () {
    if (dialog.open) dialog.close();
    dialog.showModal();
  });
  closer.addEventListener('click', function (event) {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('click', function (event) {
    var bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  if (dialog.open) { dialog.close(); dialog.showModal(); }
});`);
      }
      if (isTabsTemplate(node) && !tabsSelectors.has(selector)) {
        tabsSelectors.add(selector);
        blocks.push(tabsRuntime(selector));
      }
      for (const interaction of interactionsOf(node)) {
        // an interaction that applies to a class binds every element with it (model.ts scope, "Applies to": EV1)
        const wired = wiringJs(node, interaction, () => (interaction.scope === undefined ? selectorOf(node.id as NodeId) : `.${interaction.scope}`), selectorOf);
        // the same binding once: the instances of a component share their class, so their copies of one interaction
        // write the same block, which binds every one of them already (EV1)
        if (wired !== null && !blocks.includes(wired)) blocks.push(wired);
      }
    }
  }
  if (blocks.length === 0) return null;
  return [
    '// Generated by Builder: the interactions of the site. Plain JavaScript, no dependencies.',
    '(function () {',
    "  'use strict';",
    '  var each = function (selector, run) {',
    '    var found = document.querySelectorAll(selector);',
    '    for (var i = 0; i < found.length; i += 1) run(found[i]);',
    '  };',
    ...blocks.map((block) => block.split('\n').map((line) => `  ${line}`).join('\n')),
    '})();',
    '',
  ].join('\n');
}

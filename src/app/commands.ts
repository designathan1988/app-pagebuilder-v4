import { setAssistantModel, setAssistantPreferences, attachAssistantReference, clearAssistantReference, editAssistantKey, sendAssistant, cancelAssistant, connectAssistant, disconnectAssistant, saveAssistantKey, deleteAssistantKey, selectAssistantSession, clearAssistantConversation, reportAssistant } from '../editor/assistant/state.ts';
// The command table: the one map from every command of the manifest to its handler, or to NOT_AVAILABLE_YET while
// its feature is not built (its doors are drawn disabled with "not available yet"). CommandTable has a key for every
// CommandId (src/generated/ids.ts), so a missing or an extra entry, or a handler under another command's key, is a
// type error (src/app/commands.typecheck.ts proves it). The order is the manifest's.
import { MODULE_COMMANDS, MODULE_PREDICATES } from './modules.ts';
import { always, type CommandTable, type PredicateTable } from '../core/commands/registry.ts';
import { setLinkCommand } from '../core/elements/link.ts';
import { createFileCommand, createFolderCommand, deleteFileCommand, moveFileCommand, renameFileCommand, saveFileContentCommand, uploadCommand } from '../core/files/files.ts';
import { insertImageFileCommand } from '../core/files/assets.ts';
import { removeCustomAttributeCommand, setAttributeCommand, setClassesCommand, setCustomAttributeCommand, setIdCommand } from '../core/elements/attributes.ts';
import { copyCommand, copyStyleCommand, cutCommand, pasteCommand, pasteStyleCommand } from '../core/clipboard/clipboard.ts';
import { setEmbedMarkupCommand } from '../core/elements/embed.ts';
import { setSvgMarkupCommand } from '../core/elements/svg.ts';
import { removeSwatchCommand, saveSwatchCommand } from '../core/design/colors.ts';
import { createToken, deleteToken, renameToken, updateToken } from '../core/design/tokens.ts';
import { colourToVariableCommand, replaceColourCommand } from '../core/design/site-colours.ts';
import { applySuggestionCommand } from '../core/design/suggest.ts';
import { applyToSimilarCommand, moveIntoClassCommand, applyClassCommand, createClassCommand, deleteClassCommand, detachClassCommand, renameClassCommand } from '../core/design/classes.ts';
import { setVariantCommand, insideInstance, updateFromInstanceCommand, createComponentCommand, detachInstanceCommand, fillFromDataCommand, repeatCommand, insertInstanceCommand, instanceSelected } from '../core/design/components.ts';
import { closeComponentPrompt, openComponentPrompt } from '../editor/shell/component-prompt.ts';
import { addGridTrack, enterGridEdit, exitGridEdit, mergeGridCells, removeGridTrack, spanGridItem, splitGridCells } from '../editor/canvas/grid-edit.ts';
import { setStyleTarget } from '../editor/inspector/style-target.ts';
import { addKeyframeCommand, createAnimationCommand, deleteAnimationCommand, deleteKeyframeCommand, moveKeyframeCommand, renameAnimationCommand, setAnimationSettingsCommand, setKeyframeEasingCommand } from '../core/animation/animation.ts';
import { addInteractionCommand, removeInteractionCommand, updateInteractionCommand } from '../core/events/interactions.ts';
import { makePicked, makePicking } from '../editor/inspector/pick-target.ts';
import { setPlayheadCommand, showAnimationCommand } from '../editor/timeline/playhead.ts';
import { addActionCommand, addMarkerCommand, addMotionCommand, createTimelineCommand, deleteKeyframesCommand, deleteTimelineCommand, editKeyframeCommand, moveActionsCommand, moveKeyframesCommand, moveMarkerCommand, pasteKeyframesCommand, removeActionsCommand, removeBehaviourCommand, removeMarkerCommand, removeMotionCommand, renameMarkerCommand, renameTimelineCommand, resizeActionCommand, setBehaviourCommand, setEffectOptionCommand, setKeyframeCommand, updateActionCommand, updateMotionCommand } from '../core/motion/commands.ts';
import { copyMotionKeyframesCommand, makeMotionPicked, makeMotionPicking, openTimelineCommand, previewMotionCommand, selectMotionCommand, setMotionPlayheadCommand, toggleRecordCommand, toggleRunCommand, toggleSnapCommand, zoomTimelineCommand } from '../editor/motion/state.ts';
import { pauseCommand, playCommand, stopCommand, toggleLoopCommand } from '../editor/timeline/preview.ts';
import { copyPane, downloadPane, setPane } from '../editor/code-panel/code-panel.ts';
import { setEditorView } from '../editor/view/editor-view.ts';
import { selectTool } from '../editor/view/select-tool.ts';
import { openFile, startRenameFile } from '../editor/explorer/explorer.ts';
import { closeFileTab } from '../editor/explorer/file-tabs.ts';
import { setInputTypeCommand, setLabelTargetCommand } from '../core/elements/inputs.ts';
import { addPartCommand, movePartCommand, removePartCommand, togglePartCommand } from '../core/elements/parts.ts';
import { addColumnAfterCommand, addColumnEndCommand, addRowAfterCommand, cellSelected, inTable, removeColumnCommand, removeRowCommand } from '../core/elements/table.ts';
import { setTagCommand } from '../core/elements/tag.ts';
import { canRedo, canUndo, redoCommand, undoCommand } from '../core/history/history.ts';
import { editableSelection, setLayerColorCommand, toggleHiddenCommand, toggleLockCommand } from '../core/nodes/flags.ts';
import { renameCommand } from '../core/nodes/names.ts';
import { setPageSettingCommand } from '../core/page/settings.ts';
import { openProject, saveProject } from '../core/project/archive.ts';
import {
  addCommand,
  rangeCommand,
  clearSelectionCommand,
  hasSelection,
  targetOrSelection,
  marqueeCommand,
  selectAllInContainerCommand,
  selectCommand,
  singleSelection,
  toggleCommand,
  walkFirstChildCommand,
  walkNextSiblingCommand,
  walkParentCommand,
  walkPreviousSiblingCommand,
} from '../core/selection/selection.ts';
import { duplicateCommand } from '../core/structure/duplicate.ts';
import { handCommands } from '../core/structure/hand.ts';
import { createNaturalChildCommand, hasNaturalChild, insertCommand } from '../core/structure/insert.ts';
import { canMoveDown, canMoveUp, canNestIntoPrevious, canPromote, moveDownCommand, moveToCommand, moveUpCommand, nestIntoPreviousCommand, promoteCommand } from '../core/structure/move.ts';
import { deleteCommand } from '../core/structure/remove.ts';
import { canUnwrap, unwrapCommand, wrapBesideCommand, wrapColumnCommand, wrapContainerCommand, wrapGridCommand, wrapRowCommand } from '../core/structure/wrap.ts';
import { setCustomDeclarationsCommand } from '../core/style/custom.ts';
import { setStyleCommand } from '../core/style/set.ts';
import { applyCssRuleCommand } from '../core/style/css-rule.ts';
import { applyHtmlCommand } from '../core/import/apply-html.ts';
import { openFolderCommand } from '../core/import/folder.ts';
import { choosingImport } from '../editor/import/html-import.ts';
import { importHtmlCommand } from '../core/import/import.ts';
import { editCaptureCommand } from '../core/capture/edits.ts';
import { selectCapturedCommand } from '../editor/capture/selection.ts';
import { setSpacingCommand } from '../core/style/spacing.ts';
import { exportProject } from '../core/export/export.ts';
import { setBackgroundImageCommand } from '../core/style/background-image.ts';
import { setGridTracksCommand } from '../core/style/tracks.ts';
import { stackOnPhoneCommand, swapDirectionCommand } from '../core/style/direction.ts';
import { organizeCommand, organizableSelection } from '../core/style/organize.ts';
import { divideableSelection, setDividerCommand } from '../core/style/divider.ts';
import { setGridItemCommand } from '../core/style/grid-item.ts';
import { flexOrGridContainer, setAlignmentCommand } from '../core/style/alignment.ts';
import { setBorderCommand, setRadiusCommand } from '../core/style/border.ts';
import { movePositionedCommand, positionedSelection, setPositionModeCommand } from '../core/geometry/position.ts';
import { setAnchorsCommand } from '../core/geometry/anchors.ts';
import { alignCommand, distributableSelection, distributeCommand } from '../core/geometry/align.ts';
import { createGuideCommand, deleteGuideCommand, moveGuideCommand, toggleGuideLockCommand } from '../core/page/guides.ts';
import { setFilterCommand } from '../core/style/filter.ts';
import { setTransformCommand } from '../core/style/transform.ts';
import { setShadowsCommand } from '../core/style/shadows.ts';
import { resetAllCommand, resetValueCommand } from '../core/style/reset.ts';
import { applyColorPicker, cancelColorPicker, openColorPicker, setColorChannel, setColorFormat } from '../editor/inspector/color-picker.ts';
import { closingAssetPicker, closeAssetPicker, openAssetPicker } from '../editor/shell/asset-picker.ts';
import { closeLinkPicker, closingPicker, openLinkPicker, setLinkKind } from '../editor/shell/link-picker.ts';
import { toggleSpacingLink } from '../editor/inspector/spacing.ts';
import { setTextCommand } from '../core/text/text.ts';
import { cancelEdit, editLink, insertLineBreak, pasteText, selectAllText, singleTextSelection, startEdit, toggleBold, toggleItalic } from '../editor/canvas/text-edit.ts';
import { cancelDrag, levelDown, levelUp } from '../editor/drag/drag-session.ts';
import { focusActivate, focusCanvas, focusFirst, focusLast, focusMenuBar, focusNext, focusNextMenu, focusNextRegion, focusPrevious, focusPreviousMenu, focusPreviousRegion } from '../editor/focus/focus.ts';
import { cancelRename, startRename } from '../editor/layers/rename.ts';
import { collapseAll, collapseOrFocusParent, expandAll, expandOrFocusChild, search, setExpanded, setRowDetails } from '../editor/layers/tree.ts';
import { pan, zoomAt, zoomFit, zoomIn, zoomOut, zoomReset, zoomToLevel } from '../editor/view/camera.ts';
import { resizeCommand } from '../core/geometry/resize.ts';
import { toggleEqualSpacing, toggleGuidesVisible, toggleOutlines, toggleRulers, toggleSmartGuides, toggleZones, toggleSideBySide } from '../editor/view/overlays.ts';
import { openDialog } from '../editor/workspace/dialogs.ts';
import { setBreakpoint, setViewportWidth } from '../editor/view/breakpoints.ts';
import { resizeViewport } from '../editor/view/frame-edge.ts';
import { addBreakpoint, removeBreakpoint, renameBreakpoint, setBreakpointWidth } from '../editor/view/breakpoint-table.ts';
import { setStyleState } from '../editor/view/style-state.ts';
import { enterPreview, exitPreview } from '../editor/view/preview.ts';
import { newBlankPage } from '../core/project/project.ts';
import { addPageCommand, deletePageCommand, duplicatePageCommandFor, renamePageCommand, switchPageCommand } from '../core/project/pages.ts';
import { addFieldCommand, addItemCommand, bindElementCommand, createCollectionCommand, deleteCollectionCommand, deleteItemsCommand, detachRegionCommand, fillCommand, moveItemCommand, pagesFromCollectionCommand, pagesFromNamesCommand, removeFieldCommand, renameCollectionCommand, setCellCommand, setFieldCommand, shareRegionCommand, stopSharingCommand, unbindCommand } from '../core/data/commands.ts';
import { choosePreviewSheet, closePreview, importInto, importNew, previewFile, selectCollection, setPreviewType, setQuery } from '../editor/data/state.ts';
import { restoreVersion } from '../core/project/recovery.ts';
import { takeOverEditing } from '../core/project/tab-guard.ts';
import { setSnapEnabled, setSnapSettings } from '../editor/view/snap.ts';
import { setGridSettings, toggleColumns, toggleDots, toggleFolds, toggleRows } from '../core/page/grid.ts';
import { contextMenuOpen } from '../editor/menus/context-menu.ts';
import { dismiss } from '../editor/menus/overlays.ts';
import { setDensity, toggleGroup } from '../editor/palette/palette.ts';
import { setLanguage, setTheme } from '../editor/preferences/preferences.ts';
import type { EditorUi } from '../editor/state.ts';
import { openPageProperties } from '../editor/inspector/page-properties.ts';
import { cancelField, scrubField, setFieldUnit, stepField } from '../editor/inspector/number-field.ts';
import { revealField, searchInspector, toggleSection, setMode } from '../editor/inspector/sections.ts';
import { fixCheck } from '../editor/checks/fix.ts';
import { toggleRow } from '../editor/inspector/concept-rows.ts';
import { setOffset, setOpen } from '../editor/quick-panel/quick-panel.ts';
import { setEditMode } from '../editor/canvas/edit-mode.ts';
import { stepHandle } from '../editor/canvas/handles.ts';
import { openCommandBar } from '../editor/command-bar/command-bar.ts';
import { movePanel, resetWorkspace, resizeSplitter, setActiveTab, setWorkbenchState } from '../editor/workspace/layout.ts';
import { collapseDocks, setPanelOpen, toggleDeveloperTools, toggleInspector, toggleLeftDock } from '../editor/workspace/panels.ts';
import { setCodeLanguage, setProjectLanguage } from '../core/project/language.ts';
import { renameManyCommand } from '../core/nodes/rename-many.ts';
import { captureUrlCommand } from '../editor/import/capture.ts';

// the hand's commands, for the editor state that holds the hand
const HAND = handCommands<EditorUi>();
// interactions.update, for the editor state that holds the interaction target being picked
const INTERACTIONS_UPDATE = updateInteractionCommand<EditorUi>({ makePicking, makePicked });
// motion.updateAction, for the editor state that holds the action whose target is being picked
const MOTION_UPDATE_ACTION = updateActionCommand<EditorUi>({ makePicking: makeMotionPicking, makePicked: makeMotionPicked });
// the page the editor shows (pages.switch): the handler the editor's own state binds (core/project/pages.ts)
const SWITCH_PAGE = switchPageCommand<EditorUi>();

export const COMMANDS = {
  // 23 content and data (spec content-data): the Data panel's collections, import, bindings, pages and shared regions
  'data.select': selectCollection,
  'data.setQuery': setQuery,
  'data.createCollection': createCollectionCommand<EditorUi>(),
  'data.renameCollection': renameCollectionCommand<EditorUi>(),
  'data.deleteCollection': deleteCollectionCommand<EditorUi>(),
  'data.addField': addFieldCommand<EditorUi>(),
  'data.setField': setFieldCommand,
  'data.removeField': removeFieldCommand,
  'data.addItem': addItemCommand,
  'data.setCell': setCellCommand,
  'data.deleteItems': deleteItemsCommand,
  'data.moveItem': moveItemCommand,
  'data.preview': previewFile,
  'data.previewSheet': choosePreviewSheet,
  'data.previewType': setPreviewType,
  'data.closePreview': closePreview,
  'data.importNew': importNew,
  'data.importInto': importInto,
  'data.bindElement': bindElementCommand,
  'data.fill': fillCommand,
  'data.unbind': unbindCommand,
  'pages.fromNames': pagesFromNamesCommand<EditorUi>(),
  'pages.fromCollection': pagesFromCollectionCommand<EditorUi>(),
  'regions.share': shareRegionCommand,
  'regions.detach': detachRegionCommand,
  'regions.stopSharing': stopSharingCommand,
  'assistant.setModel': setAssistantModel,
  'assistant.setPreferences': setAssistantPreferences,
  'assistant.attachReference': attachAssistantReference,
  'assistant.clearReference': clearAssistantReference,
  'assistant.editKey': editAssistantKey,
  'assistant.send': sendAssistant,
  'assistant.cancel': cancelAssistant,
  'assistant.connect': connectAssistant,
  'assistant.disconnect': disconnectAssistant,
  'assistant.saveKey': saveAssistantKey,
  'assistant.deleteKey': deleteAssistantKey,
  'assistant.selectSession': selectAssistantSession,
  'assistant.clearConversation': clearAssistantConversation,
  'assistant.update': reportAssistant,
  'animation.create': createAnimationCommand,
  'animation.rename': renameAnimationCommand,
  'animation.delete': deleteAnimationCommand,
  'animation.addKeyframe': addKeyframeCommand,
  'animation.moveKeyframe': moveKeyframeCommand,
  'animation.setKeyframeEasing': setKeyframeEasingCommand,
  'animation.deleteKeyframe': deleteKeyframeCommand,
  'animation.setSettings': setAnimationSettingsCommand,
  'timeline.setPlayhead': setPlayheadCommand,
  'timeline.show': showAnimationCommand,
  'timeline.play': playCommand,
  'timeline.pause': pauseCommand,
  'timeline.stop': stopCommand,
  'timeline.toggleLoop': toggleLoopCommand,
  'clipboard.copy': copyCommand,
  'clipboard.paste': pasteCommand,
  'clipboard.cut': cutCommand,
  'clipboard.copyStyle': copyStyleCommand,
  'clipboard.pasteStyle': pasteStyleCommand,
  'colors.saveSwatch': saveSwatchCommand,
  'colors.removeSwatch': removeSwatchCommand,
  'tokens.create': createToken,
  'tokens.update': updateToken,
  'design.replaceColour': replaceColourCommand,
  'project.captureUrl': captureUrlCommand,
  'capture.edit': editCaptureCommand,
  'capture.select': selectCapturedCommand,
  'components.updateFromInstance': updateFromInstanceCommand,
  'components.setVariant': setVariantCommand,
  'design.applySuggestion': applySuggestionCommand,
  'classes.moveInto': moveIntoClassCommand,
  'classes.applyToSimilar': applyToSimilarCommand,
  'design.colourToVariable': colourToVariableCommand,
  'tokens.rename': renameToken,
  'tokens.delete': deleteToken,
  'classes.create': createClassCommand,
  'classes.apply': applyClassCommand,
  'classes.detach': detachClassCommand,
  'classes.rename': renameClassCommand,
  'classes.delete': deleteClassCommand,
  'inspector.setStyleTarget': setStyleTarget,
  'components.create': createComponentCommand,
  'components.startCreate': openComponentPrompt,
  'components.closePrompt': closeComponentPrompt,
  'components.insertInstance': insertInstanceCommand,
  'components.detach': detachInstanceCommand,
  'components.repeat': repeatCommand,
  'components.fillFromData': fillFromDataCommand,
  'element.setTag': setTagCommand,
  'element.setAttribute': closingAssetPicker(setAttributeCommand),
  'element.setId': setIdCommand,
  'element.setClasses': setClassesCommand,
  'element.setLink': closingPicker(setLinkCommand),
  'element.setInputType': setInputTypeCommand,
  'element.setLabelTarget': setLabelTargetCommand,
  'element.setCustomAttribute': setCustomAttributeCommand,
  'element.removeCustomAttribute': removeCustomAttributeCommand,
  'element.setSvgMarkup': setSvgMarkupCommand,
  'element.setEmbedMarkup': setEmbedMarkupCommand,
  'element.applyHtml': applyHtmlCommand,
  'parts.toggle': togglePartCommand,
  'parts.add': addPartCommand,
  'parts.move': movePartCommand,
  'parts.remove': removePartCommand,
  'table.addColumnAfter': addColumnAfterCommand,
  'table.addColumnEnd': addColumnEndCommand,
  'table.removeColumn': removeColumnCommand,
  'table.addRowAfter': addRowAfterCommand,
  'table.removeRow': removeRowCommand,
  'interactions.add': addInteractionCommand,
  'interactions.update': INTERACTIONS_UPDATE,
  'interactions.remove': removeInteractionCommand,
  'motion.add': addMotionCommand,
  'motion.update': updateMotionCommand,
  'motion.remove': removeMotionCommand,
  'motion.createTimeline': createTimelineCommand,
  'motion.renameTimeline': renameTimelineCommand,
  'motion.deleteTimeline': deleteTimelineCommand,
  'motion.openTimeline': openTimelineCommand,
  'motion.addAction': addActionCommand,
  'motion.updateAction': MOTION_UPDATE_ACTION,
  'motion.setEffectOption': setEffectOptionCommand,
  'motion.removeActions': removeActionsCommand,
  'motion.moveActions': moveActionsCommand,
  'motion.resizeAction': resizeActionCommand,
  'motion.select': selectMotionCommand,
  'motion.setPlayhead': setMotionPlayheadCommand,
  'motion.zoomTimeline': zoomTimelineCommand,
  'motion.toggleSnap': toggleSnapCommand,
  'motion.addMarker': addMarkerCommand,
  'motion.moveMarker': moveMarkerCommand,
  'motion.renameMarker': renameMarkerCommand,
  'motion.removeMarker': removeMarkerCommand,
  'motion.setKeyframe': setKeyframeCommand,
  'motion.editKeyframe': editKeyframeCommand,
  'motion.moveKeyframes': moveKeyframesCommand,
  'motion.deleteKeyframes': deleteKeyframesCommand,
  'motion.copyKeyframes': copyMotionKeyframesCommand,
  'motion.pasteKeyframes': pasteKeyframesCommand,
  'motion.toggleRecord': toggleRecordCommand,
  'motion.preview': previewMotionCommand,
  'motion.toggleRun': toggleRunCommand,
  'motion.setBehaviour': setBehaviourCommand,
  'motion.removeBehaviour': removeBehaviourCommand,
  'pages.add': addPageCommand<EditorUi>(),
  'pages.rename': renamePageCommand,
  'pages.duplicate': duplicatePageCommandFor<EditorUi>(),
  'pages.delete': deletePageCommand,
  'pages.switch': SWITCH_PAGE,
  'files.createFolder': createFolderCommand,
  'files.createFile': createFileCommand,
  'files.startRename': startRenameFile,
  'files.rename': renameFileCommand,
  'files.move': moveFileCommand,
  'files.delete': deleteFileCommand,
  'files.open': openFile,
  'files.closeTab': closeFileTab,
  'files.upload': uploadCommand,
  'files.saveContent': saveFileContentCommand,
  'assets.insertImageFile': insertImageFileCommand,
  'focus.next': focusNext,
  'focus.menuBar': focusMenuBar,
  'focus.nextMenu': focusNextMenu,
  'focus.previousMenu': focusPreviousMenu,
  'focus.previous': focusPrevious,
  'focus.first': focusFirst,
  'focus.last': focusLast,
  'focus.activate': focusActivate,
  'focus.nextRegion': focusNextRegion,
  'focus.previousRegion': focusPreviousRegion,
  'focus.canvas': focusCanvas,
  'ui.dismiss': dismiss,
  'position.setMode': setPositionModeCommand,
  'geometry.resize': resizeCommand,
  'position.move': movePositionedCommand,
  'position.setAnchors': setAnchorsCommand,
  'position.align': alignCommand,
  'position.distribute': distributeCommand,
  'handle.step': stepHandle,
  'canvas.setEditMode': setEditMode,
  'history.undo': undoCommand,
  'history.redo': redoCommand,
  'layers.startRename': startRename,
  'layers.cancelRename': cancelRename,
  'element.rename': renameCommand,
  'element.renameMany': renameManyCommand,
  'element.toggleLock': toggleLockCommand,
  'element.toggleHidden': toggleHiddenCommand,
  'element.setLayerColor': setLayerColorCommand,
  'page.openProperties': openPageProperties,
  'page.setSetting': setPageSettingCommand,
  'project.newBlankPage': newBlankPage,
  'project.restoreVersion': restoreVersion,
  'project.takeOverEditing': takeOverEditing,
  'project.save': saveProject,
  'project.setLanguage': setProjectLanguage,
  'project.setCodeLanguage': setCodeLanguage,
  'project.open': openProject,
  'project.openFolder': openFolderCommand,
  'project.importHtml': choosingImport(importHtmlCommand),
  'project.export': exportProject,
  'selection.select': selectCommand,
  'selection.clear': clearSelectionCommand,
  'selection.add': addCommand,
  'selection.range': rangeCommand,
  'selection.toggle': toggleCommand,
  'selection.walkNextSibling': walkNextSiblingCommand,
  'selection.walkPreviousSibling': walkPreviousSiblingCommand,
  'selection.walkParent': walkParentCommand,
  'selection.walkFirstChild': walkFirstChildCommand,
  'selection.selectAllInContainer': selectAllInContainerCommand,
  'selection.marquee': marqueeCommand,
  'contextMenu.open': contextMenuOpen,
  'element.insert': insertCommand,
  'element.moveTo': moveToCommand,
  'drag.levelUp': levelUp,
  'drag.levelDown': levelDown,
  'drag.cancel': cancelDrag,
  'element.moveUp': moveUpCommand,
  'element.moveDown': moveDownCommand,
  'element.wrapRow': wrapRowCommand,
  'element.wrapColumn': wrapColumnCommand,
  'element.wrapContainer': wrapContainerCommand,
  'element.wrapGrid': wrapGridCommand,
  'element.wrapBeside': wrapBesideCommand,
  'element.nestIntoPrevious': nestIntoPreviousCommand,
  'element.promote': promoteCommand,
  'element.duplicate': duplicateCommand,
  'element.delete': deleteCommand,
  'element.unwrap': unwrapCommand,
  'element.createNaturalChild': createNaturalChildCommand,
  'hand.take': HAND.take,
  'hand.aimNext': HAND.aimNext,
  'hand.aimPrevious': HAND.aimPrevious,
  'hand.climb': HAND.climb,
  'hand.descend': HAND.descend,
  'hand.drop': HAND.drop,
  'style.set': setStyleCommand,
  'style.setSpacing': setSpacingCommand,
  'element.swapDirection': swapDirectionCommand,
  'element.stackOnPhone': stackOnPhoneCommand,
  'element.organize': organizeCommand,
  'element.setDivider': setDividerCommand,
  'inspector.toggleSpacingLink': toggleSpacingLink,
  'linkPicker.open': openLinkPicker,
  'linkPicker.setKind': setLinkKind,
  'linkPicker.close': closeLinkPicker,
  'assetPicker.open': openAssetPicker,
  'assetPicker.close': closeAssetPicker,
  'colorPicker.open': openColorPicker,
  'colorPicker.setFormat': setColorFormat,
  'colorPicker.setChannel': setColorChannel,
  'colorPicker.apply': applyColorPicker,
  'colorPicker.cancel': cancelColorPicker,
  'style.setBorder': setBorderCommand,
  'style.setRadius': setRadiusCommand,
  'style.setBackgroundImage': setBackgroundImageCommand,
  'style.setGridTracks': setGridTracksCommand,
  'grid.enterEdit': enterGridEdit,
  'grid.exitEdit': exitGridEdit,
  'grid.addTrack': addGridTrack,
  'grid.removeTrack': removeGridTrack,
  'grid.spanItem': spanGridItem,
  'grid.mergeCells': mergeGridCells,
  'grid.splitCells': splitGridCells,
  'style.setGridItem': setGridItemCommand,
  'style.setShadows': setShadowsCommand,
  'style.setFilter': setFilterCommand,
  'style.setTransform': setTransformCommand,
  'style.setAlignment': setAlignmentCommand,
  'style.setCustomDeclarations': setCustomDeclarationsCommand,
  'style.applyCssRule': applyCssRuleCommand,
  'style.reset': resetValueCommand,
  'style.resetAll': resetAllCommand,
  'field.step': stepField,
  'field.scrub': scrubField,
  'field.setUnit': setFieldUnit,
  'field.cancel': cancelField,
  'text.startEdit': startEdit,
  'text.set': setTextCommand,
  'text.cancelEdit': cancelEdit,
  'text.insertLineBreak': insertLineBreak,
  'text.toggleBold': toggleBold,
  'text.toggleItalic': toggleItalic,
  'text.editLink': editLink,
  'text.paste': pasteText,
  'text.selectAll': selectAllText,
  'view.zoomIn': zoomIn,
  'view.zoomOut': zoomOut,
  'view.zoomReset': zoomReset,
  'view.zoomTo': zoomToLevel,
  'view.zoomFit': zoomFit,
  'view.zoomAt': zoomAt,
  'view.pan': pan,
  'view.setBreakpoint': setBreakpoint,
  'view.setViewportWidth': setViewportWidth,
  'view.resizeViewport': resizeViewport,
  'view.toggleSideBySide': toggleSideBySide,
  'view.selectTool': selectTool,
  'breakpoints.add': addBreakpoint,
  'breakpoints.rename': renameBreakpoint,
  'breakpoints.setWidth': setBreakpointWidth,
  'breakpoints.remove': removeBreakpoint,
  'view.setEditorView': setEditorView,
  'view.setStyleState': setStyleState,
  'view.enterPreview': enterPreview,
  'view.exitPreview': exitPreview,
  'view.toggleOutlines': toggleOutlines,
  'view.toggleZones': toggleZones,
  'view.toggleRulers': toggleRulers,
  'view.toggleSmartGuides': toggleSmartGuides,
  'view.toggleEqualSpacing': toggleEqualSpacing,
  'grid.toggleColumns': toggleColumns,
  'grid.toggleRows': toggleRows,
  'grid.toggleDots': toggleDots,
  'grid.toggleFolds': toggleFolds,
  'grid.setSettings': setGridSettings,
  'guides.create': createGuideCommand,
  'guides.move': moveGuideCommand,
  'guides.delete': deleteGuideCommand,
  'guides.toggleLock': toggleGuideLockCommand,
  'guides.toggleVisible': toggleGuidesVisible,
  'snap.setEnabled': setSnapEnabled,
  'snap.setSettings': setSnapSettings,
  'workspace.openDialog': openDialog,
  'workspace.setPanelOpen': setPanelOpen,
  'workspace.toggleLeftDock': toggleLeftDock,
  'workspace.toggleInspector': toggleInspector,
  'workspace.collapseDocks': collapseDocks,
  'workspace.toggleDeveloperTools': toggleDeveloperTools,
  'workspace.reset': resetWorkspace,
  'workspace.setWorkbenchState': setWorkbenchState,
  'workspace.setActiveTab': setActiveTab,
  'workspace.resizeSplitter': resizeSplitter,
  'workspace.movePanel': movePanel,
  'quickPanel.setOffset': setOffset,
  'quickPanel.setOpen': setOpen,
  'preferences.setLanguage': setLanguage,
  'preferences.setTheme': setTheme,
  'commandBar.open': openCommandBar,
  'palette.toggleGroup': toggleGroup,
  'palette.setDensity': setDensity,
  'layers.setExpanded': setExpanded,
  'layers.collapseAll': collapseAll,
  'layers.expandAll': expandAll,
  'layers.expandOrFocusChild': expandOrFocusChild,
  'layers.collapseOrFocusParent': collapseOrFocusParent,
  'layers.setRowDetails': setRowDetails,
  'layers.search': search,
  'inspector.toggleSection': toggleSection,
  'inspector.toggleRow': toggleRow,
  'inspector.setMode': setMode,
  'inspector.reveal': revealField,
  'checks.applyFix': fixCheck,
  'inspector.search': searchInspector,
  'codePanel.setPane': setPane,
  'codePanel.copyPane': copyPane,
  'codePanel.downloadPane': downloadPane,
  // the commands of the installed modules (app/modules.ts)
  ...MODULE_COMMANDS,
} as const satisfies CommandTable<EditorUi>;

// The availability predicates code has registered; a built command's predicate must be here (createStore checks it).
export const PREDICATES = {
  always,
  canUndo,
  canRedo,
  hasSelection,
  targetOrSelection,
  singleSelection,
  singleTextSelection,
  canUnwrap,
  canNestIntoPrevious,
  canMoveUp,
  canMoveDown,
  canPromote,
  cellSelected,
  inTable,
  hasNaturalChild,
  flexOrGridContainer,
  instanceSelected,
  insideInstance,
  positionedSelection,
  distributableSelection,
  editableSelection,
  organizableSelection,
  divideableSelection,
  ...MODULE_PREDICATES
} as const satisfies PredicateTable<EditorUi>;

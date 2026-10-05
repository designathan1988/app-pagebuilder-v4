// The settings each layout grid takes (spec workspace-settings-dialog): what the page's `grid` holds (model.ts), what
// validate.ts accepts, what grid.setSettings writes and what Guides & Grids draws a field for, in this order. Each
// setting names its label, and its default and its range in interactions.json.
const GRID_SETTINGS = {
  columns: {
    count: { labelKey: 'guidesGrids.setting.count', byDefault: 'grid.columns', range: 'grid.columnsRange' },
    width: { labelKey: 'guidesGrids.setting.width', byDefault: 'grid.width', range: 'grid.widthRange' },
    gutter: { labelKey: 'guidesGrids.setting.gutter', byDefault: 'grid.gutter', range: 'grid.gutterRange' },
    margin: { labelKey: 'guidesGrids.setting.margin', byDefault: 'grid.margin', range: 'grid.marginRange' },
  },
  rows: {
    height: { labelKey: 'guidesGrids.setting.height', byDefault: 'grid.rowHeight', range: 'grid.rowHeightRange' },
    gutter: { labelKey: 'guidesGrids.setting.gutter', byDefault: 'grid.rowGutter', range: 'grid.rowGutterRange' },
  },
  dots: {
    spacing: { labelKey: 'guidesGrids.setting.spacing', byDefault: 'grid.dotSpacing', range: 'grid.dotSpacingRange' },
  },
} as const;

export type GridName = keyof typeof GRID_SETTINGS;
export interface GridSetting {
  readonly labelKey: string;
  readonly byDefault: string;
  readonly range: string;
}
// a grid's settings, in order, by name
export const settingsOf = (grid: string): readonly (readonly [string, GridSetting])[] => (grid in GRID_SETTINGS ? Object.entries(GRID_SETTINGS[grid as GridName]) : []);
export const settingOf = (grid: string, setting: string): GridSetting | undefined => settingsOf(grid).find(([name]) => name === setting)?.[1];

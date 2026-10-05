interface Argument { type: string; values: readonly string[]; optional: boolean }
export interface ManifestCommand { id: string; labelKey: string; args: Readonly<Record<string, Argument>>; history: { undoable: boolean }; confirmation?: unknown }
export interface ToolDefinition { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false } }
export const toolName = (id: string) => id.replaceAll('.', '_');
// Geometry argument fields describe a rectangle, not editable CSS properties.
const pointProperties = { x: { type: 'number' }, y: { type: 'number' } };
const rectProperties = { ...pointProperties, width: { type: 'number' }, height: { type: 'number' } };
const schema = (arg: Argument): Record<string, unknown> => {
  if (arg.type === 'enum') return { type: 'string', enum: arg.values };
  if (arg.type === 'nodes') return { type: 'array', items: { type: 'string' } };
  if (['number', 'integer', 'boolean'].includes(arg.type)) return { type: arg.type };
  if (arg.type === 'json' || arg.type === 'clipboard' || arg.type === 'file' || arg.type === 'files') return {};
  if (arg.type === 'point' || arg.type === 'rect') {
    const properties = arg.type === 'point' ? pointProperties : rectProperties;
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  }
  return { type: 'string' };
};
export function toolCatalogue(commands: readonly ManifestCommand[], words: (key: string) => string): ToolDefinition[] {
  const names = new Set<string>();
  return commands.map(command => {
    const name = toolName(command.id);
    if (names.has(name)) throw new Error(`Tool name collision: ${name}`);
    names.add(name);
    return { name, description: words(command.labelKey), input_schema: { type: 'object', properties: Object.fromEntries(Object.entries(command.args).map(([key, arg]) => [key, schema(arg)])), required: Object.entries(command.args).filter(([, arg]) => !arg.optional).map(([key]) => key), additionalProperties: false } };
  });
}
export function validateArguments(command: ManifestCommand, args: unknown): string[] {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ['Arguments must be an object'];
  const record = args as Record<string, unknown>, issues: string[] = [];
  for (const name of Object.keys(record)) if (!Object.hasOwn(command.args, name)) issues.push(`Unknown argument: ${name}`);
  for (const [name, arg] of Object.entries(command.args)) {
    const value = record[name];
    if (value === undefined) {
      if (!arg.optional) issues.push(`Missing argument: ${name}`);
      continue;
    }
    let valid = true;
    if (arg.type === 'enum') valid = typeof value === 'string' && arg.values.includes(value);
    else if (arg.type === 'number') valid = typeof value === 'number' && Number.isFinite(value);
    else if (arg.type === 'integer') valid = Number.isInteger(value);
    else if (arg.type === 'boolean') valid = typeof value === 'boolean';
    else if (arg.type === 'nodes') valid = Array.isArray(value) && value.every(id => typeof id === 'string');
    else if (arg.type === 'point' || arg.type === 'rect') {
      const fields = Object.keys(arg.type === 'point' ? pointProperties : rectProperties);
      valid = value !== null && typeof value === 'object' && !Array.isArray(value) && fields.every(field => typeof (value as Record<string, unknown>)[field] === 'number' && Number.isFinite((value as Record<string, unknown>)[field])) && Object.keys(value).every(key => fields.includes(key));
    } else if (!['json', 'clipboard', 'file', 'files'].includes(arg.type)) valid = typeof value === 'string';
    if (!valid) issues.push(`Invalid argument: ${name}`);
  }
  return issues;
}

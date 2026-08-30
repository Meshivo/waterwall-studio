import bundleJson from '../data/generated-node-schema.json';
import type { Layer, NodeDefinition, PortDefinition, SchemaBundle } from '../types';
import { registerDerivedCounterparts } from '../data/node-experience';

export const schema = bundleJson as SchemaBundle;
export const definitions = new Map(schema.nodes.map((node) => [node.type, node]));
// Let the counterpart table derive its Client/Server pairs from the schema.
registerDerivedCounterparts(schema.nodes.map((node) => node.type));

// Read here rather than via layerGroups.ts, which imports this module.
const anything = schema.layerGroupConstants.Anything;

export function unknownDefinition(type: string): NodeDefinition {
  return {
    type, version: 0, category: 'ناشناخته', unknown: true,
    description: 'Unknown WaterWall node preserved during import.',
    descriptionFa: 'این نوع در schema فعلی وجود ندارد؛ داده خام آن حفظ شده است.',
    inputs: [port('previous', 'input', 'any', 'previous', 'ورودی')],
    outputs: [port('next', 'output', 'any', 'next', 'بعدی')], settings: [],
    flags: { chainHead: false, chainEnd: false, noChain: false, singleton: false },
    // Maximally permissive so an unknown node raises `unknown-node` and nothing
    // else — a spurious layer error on top of it would just be noise.
    layerGroups: { own: anything, prev: anything, next: anything },
    capabilities: { prev: true, next: true },
    lifecycle: ['Init', 'Est', 'Payload', 'Finish'], recommendations: [], sourcePath: ''
  };
}

function port(id:string, direction:'input'|'output', layer:Layer, semantic:PortDefinition['semantic'], labelFa:string):PortDefinition {
  return { id, direction, layer, semantic, labelFa, minConnections: 0, maxConnections: 1, required: false };
}

export function getDefinition(type: string): NodeDefinition {
  return definitions.get(type) ?? unknownDefinition(type);
}

/**
 * Heuristic over the legacy port strings, for the drag-time check and for
 * ranking suggestions. It is deliberately permissive: it knows nothing about
 * SameAs/Opposite propagation, so it accepts chains the core rejects.
 *
 * Not the layer authority — see solveGraph in ./layerSolver.
 */
export function layersCompatible(source: Layer, target: Layer): boolean {
  if (source === 'none' || target === 'none') return false;
  if (source === 'any' || target === 'any' || source === 'same' || target === 'same') return true;
  return source === target;
}

export function portLabel(layer: Layer): string {
  return ({ packet: 'بسته', stream: 'استریم', any: 'هر لایه', none: 'بدون لایه', same: 'هم‌لایه' })[layer];
}

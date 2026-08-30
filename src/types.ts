import type { Edge, Node } from '@xyflow/react';
export type Layer = 'packet' | 'stream' | 'any' | 'none' | 'same';
export type IssueSeverity = 'valid' | 'warning' | 'error' | 'info';
export interface PortDefinition { id:string; direction:'input'|'output'; layer:Layer; minConnections:number; maxConnections:number; required:boolean; semantic:'next'|'up'|'down'|'previous'|'route'; labelFa:string }
export interface FieldDefinition { id:string; type:'string'|'number'|'boolean'|'json'; required:boolean; labelFa:string; descriptionFa?:string; default?:unknown }
/** Mirrors `enum node_flags` in WaterWall-main/ww/objects/node.h. */
export interface NodeFlags { chainHead:boolean; chainEnd:boolean; noChain:boolean; singleton:boolean }
/** A raw bitmask from `enum node_layer_group` (WaterWall-main/ww/objects/node.h:112). */
export type LayerGroupMask = number;
/** The three-field layer model, verbatim from the C node metadata. Do not collapse. */
export interface LayerGroups {
  /** `.layer_group` — exactly one of None | L3 | L4 | Anything. */
  own:LayerGroupMask;
  /** `.layer_group_prev_node` — may carry SameAsNext / OppositeNext. */
  prev:LayerGroupMask;
  /** `.layer_group_next_node` — may carry SameAsPrev / OppositePrev. */
  next:LayerGroupMask;
}
/** Mirrors `.can_have_prev` / `.can_have_next`. Not inferrable from port presence. */
export interface NodeCapabilities { prev:boolean; next:boolean }
/** Numeric values of `enum node_layer_group`, read from node.h at generate time. */
export interface LayerGroupConstants { None:number; L3:number; L4:number; Anything:number; SameAsNext:number; SameAsPrev:number; OppositeNext:number; OppositePrev:number }
export interface NodeDefinition { type:string; version:number; category:string; description:string; descriptionFa:string; inputs:PortDefinition[]; outputs:PortDefinition[]; settings:FieldDefinition[]; flags:NodeFlags; /** Reference page on the docs site; absent when the node has none. */ docsUrl?:string; layerGroups:LayerGroups; capabilities:NodeCapabilities; lifecycle:string[]; recommendations:string[]; sourcePath:string; unknown?:boolean }
export interface SchemaBundle { schemaVersion:number; sourceCommit:string; generatedAt:string; nodes:NodeDefinition[]; layerGroupConstants:LayerGroupConstants; adjacency:Record<string,Record<string,AdjacencyCount>> }
/** How often a pairing was seen, kept split by corpus so the reason stays honest. */
export interface AdjacencyCount { repo:number; field:number }
export interface StudioNodeData extends Record<string, unknown> { type:string; name:string; settings:Record<string,unknown>; definition?:NodeDefinition; status?:IssueSeverity; raw?:Record<string,unknown>; occupiedHandles?:string[];
  /**
   * Layer the solver actually resolved for each side, as a short label.
   * Absent when the graph does not determine one — better no badge than a
   * confident wrong one.
   */
  resolvedLayer?:{prev?:string;next?:string}; onAddAfter?:(nodeId:string,handleId:string)=>void }
export type StudioNode = Node<StudioNodeData,'waterwall'>;
export type StudioEdge = Edge<{symbolic?:boolean;label?:string},'waterwall'>;
export interface GraphDocument { nodes:StudioNode[]; edges:StudioEdge[]; variables:Record<string,unknown>; /** Topology name from the imported config; preserved on export. */ name?:string; viewport?:{x:number;y:number;zoom:number} }
/** One of the four fixed log sinks in core.json. */
export interface CoreLogSink { loglevel:string; file?:string; console:boolean }
/**
 * `core.json` — the second half of every real deploy. It carries the runtime
 * settings and names the node config files; the graph alone is not runnable.
 * Shape verified against representative WaterWall core configurations.
 */
export interface CoreConfig {
  log:{ path:string; internal:CoreLogSink; core:CoreLogSink; network:CoreLogSink; dns:CoreLogSink };
  /** Empty in every sample, but the key is always present. */
  dns:Record<string,unknown>;
  misc:{ workers:number; 'ram-profile':string; mtu?:number; 'libs-path':string };
  /** Config filenames, resolved next to core.json. */
  configs:string[];
}
export interface StudioProject { schemaVersion:number; sourceCommit:string; name:string; updatedAt:string; activeServer:'iran'|'kharej'; servers:Record<'iran'|'kharej',GraphDocument>; core?:Record<'iran'|'kharej',CoreConfig>; migrationNotes:string[] }
export interface ValidationIssue { id:string; severity:IssueSeverity; code:string; title:string; message:string; technical:string; nodeId?:string; edgeId?:string; action?:{label:string;type:'select-node'|'remove-edge'|'configure'|'replace'|'switch-server'}; /** The counterpart node on the other server, for cross-canvas findings. */ peer?:{server:'iran'|'kharej';nodeId:string} }
export interface TrafficState { direction:'up'|'down'; layer:Layer; sourceIp?:string; destinationIp?:string; protocol?:string; notes:string[] }
export interface SimulationStep { id:string; event:'Init'|'Est'|'Payload'|'Pause'|'Resume'|'Finish'; nodeId:string; edgeId?:string; summary:string; detail:string; fidelity:'deterministic'|'symbolic'; before:TrafficState; after:TrafficState }

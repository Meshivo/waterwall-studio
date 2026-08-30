import { describe, expect, it } from 'vitest';
import type { GraphDocument, StudioNode } from '../types';
import { configFromGraph, graphFromConfig } from './importer';
import { getDefinition } from './schema';
describe('WaterWall round trip',()=>{
  it('derives PacketSplitStream branch references from edges',()=>{const make=(id:string,type:string):StudioNode=>({id,type:'waterwall',position:{x:0,y:0},data:{type,name:id,settings:{},definition:getDefinition(type)}});const graph:GraphDocument={nodes:[make('split','PacketSplitStream'),make('up-node','IpOverrider'),make('down-node','IpOverrider')],edges:[{id:'u',source:'split',target:'up-node',sourceHandle:'up',targetHandle:'previous',type:'waterwall'},{id:'d',source:'split',target:'down-node',sourceHandle:'down',targetHandle:'previous',type:'waterwall'}],variables:{}};const config=configFromGraph(graph);const split=(config.nodes as Record<string,unknown>[]).find((node)=>node.name==='split')!;expect(split.settings).toMatchObject({up:'up-node',down:'down-node'});expect(graphFromConfig(config).edges).toHaveLength(2)})
});

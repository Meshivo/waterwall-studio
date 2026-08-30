import { describe, expect, it } from 'vitest';
import type { StudioNode } from '../types';
import { getDefinition } from './schema';
import { recommendNext } from './recommender';
describe('guided recommendations',()=>{it('only returns compatible nodes',()=>{const source:StudioNode={id:'tun',type:'waterwall',position:{x:0,y:0},data:{type:'TunDevice',name:'tun',settings:{},definition:getDefinition('TunDevice')}};const result=recommendNext(source,'next',[source],[]);expect(result.length).toBeGreaterThan(0);expect(result.every((item)=>item.definition.inputs.some((port)=>port.layer==='packet'||port.layer==='any'||port.layer==='same'))).toBe(true)})});

describe("entry node suggestions", () => {
  it("offers the chain-head nodes the C source declares, including TunDevice and RawSocket", () => {
    const types = recommendNext(undefined, "next", [], []).map(
      (s) => s.definition.type,
    );
    expect(types).toContain("TunDevice");
    expect(types).toContain("RawSocket");
    expect(types).toContain("TcpListener");
    expect(types).toHaveLength(13);
  });
});

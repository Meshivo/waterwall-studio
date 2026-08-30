import type { StudioEdge, StudioNode, NodeDefinition } from '../types';
import { schema, getDefinition, layersCompatible } from './schema';

export interface RankedSuggestion { definition:NodeDefinition; score:number; reasons:string[] }

export function recommendNext(sourceNode:StudioNode|undefined, sourceHandle:string, nodes:StudioNode[], edges:StudioEdge[]):RankedSuggestion[] {
  // Entry nodes come from the kNodeFlagChainHead flag in the C source, not from
  // "has no inputs" — TunDevice, RawSocket and Bridge all take input yet are
  // legitimate chain heads, and they start every IP-spoof topology.
  if(!sourceNode)return schema.nodes.filter((def)=>def.flags.chainHead).map((definition,index)=>({definition,score:100-index,reasons:['نود آغازگر مسیر است']}));
  const output=getDefinition(sourceNode.data.type).outputs.find((port)=>port.id===sourceHandle);
  if(!output)return [];
  const currentTypes=new Set(nodes.map((node)=>node.data.type));
  return schema.nodes.flatMap((definition)=>{
    const input=definition.inputs.find((port)=>layersCompatible(output.layer,port.layer));
    if(!input||definition.type===sourceNode.data.type&&definition.type.includes('Listener'))return [];
    let score=20;const reasons:string[]=[`لایه ${output.layer} سازگار است`];
    // A pairing someone actually deployed is stronger evidence than one that
    // only appears in an upstream test, and the user is told which it is.
    const seen=schema.adjacency[sourceNode.data.type]?.[definition.type];
    if(seen?.field){score+=Math.min(50,seen.field*12);reasons.push(`در ${seen.field} کانفیگ میدانی دیده شده`)}
    if(seen?.repo){score+=Math.min(30,seen.repo*8);reasons.push(`در ${seen.repo} توپولوژی مخزن دیده شده`)}
    if(getDefinition(sourceNode.data.type).recommendations.includes(definition.type)){score+=20;reasons.push('همسایه پیشنهادی schema')}
    if(!currentTypes.has(definition.type)){score+=3;reasons.push('نقش تازه در مسیر')}
    if(definition.outputs.length===0)score+=edges.some((edge)=>edge.source===sourceNode.id)?0:4;
    return [{definition,score,reasons}];
  }).sort((a,b)=>b.score-a.score||a.definition.type.localeCompare(b.definition.type));
}

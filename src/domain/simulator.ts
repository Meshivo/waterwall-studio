import type { SimulationStep, StudioEdge, StudioNode, TrafficState } from '../types';
import { getDefinition } from './schema';
import { decomposeChains } from './chains';

const symbolicTypes=/Tls|Reality|WireGuard|Encryption|Obfuscator|Trojan|Vless|Authentication/;

/**
 * Walkable paths for the simulator, derived from the chain decomposition so the
 * two agree on what a path is. A node with no edges still yields `[id]`, as it
 * always has.
 */
export function findPaths(nodes:StudioNode[],edges:StudioEdge[]):string[][] {
  const {chains,unchained}=decomposeChains(nodes,edges);
  const paths=[...chains.map((chain)=>chain.links.map((link)=>link.nodeId)),...unchained.map((id)=>[id])];
  return paths.sort((a,b)=>b.length-a.length);
}

export function simulatePath(path:string[],nodes:StudioNode[],edges:StudioEdge[]):SimulationStep[] {
  if(!path.length)return [];
  let state:TrafficState={direction:'up',layer:getDefinition(nodes.find((node)=>node.id===path[0])?.data.type??'').outputs[0]?.layer??'any',protocol:'unknown',notes:[]};
  const steps:SimulationStep[]=[];
  for(const event of ['Init','Est'] as const)steps.push(step(event,path[0],undefined,event==='Init'?'مسیر آماده شد':'ارتباط برقرار شد','چرخه عمر مسیر آغاز شد','symbolic',state,state));
  path.forEach((id,index)=>{const node=nodes.find((item)=>item.id===id);if(!node)return;const before=clone(state);const transformed=transform(node,state);state=transformed.after;const edge=edges.find((item)=>item.source===id&&item.target===path[index+1]);steps.push(step('Payload',id,edge?.id,transformed.summary,transformed.detail,transformed.fidelity,before,state));});
  steps.push(step('Finish',path.at(-1)!,undefined,'عبور مسیر تمام شد','هیچ ترافیک واقعی ارسال نشد؛ این گزارش تحلیلی است.','symbolic',state,state));
  return steps;
}

function transform(node:StudioNode,state:TrafficState){const next=clone(state),type=node.data.type,settings=node.data.settings;if(type==='IpOverrider'){const direction=isObject(settings[state.direction])?settings[state.direction] as Record<string,unknown>:settings;const source=isObject(direction['source-ip'])?direction['source-ip'] as Record<string,unknown>:undefined;const dest=isObject(direction['dest-ip'])?direction['dest-ip'] as Record<string,unknown>:undefined;if(source?.ipv4)next.sourceIp=String(source.ipv4);if(dest?.ipv4)next.destinationIp=String(dest.ipv4);if(settings.ipv4&&settings.mode==='source-ip')next.sourceIp=String(settings.ipv4);if(settings.ipv4&&settings.mode==='dest-ip')next.destinationIp=String(settings.ipv4);next.notes=[...next.notes,'IP header rewrite'];return {after:next,summary:'آدرس IP تغییر کرد',detail:'مقادیر قبل و بعد از تنظیمات IpOverrider محاسبه شد.',fidelity:'deterministic' as const}}if(type==='PacketSplitStream'){next.layer='stream';next.notes=[...next.notes,'packet split'];return {after:next,summary:'ترافیک به شاخه رفت/برگشت تقسیم شد',detail:'شاخه انتخاب‌شده از edge جاری مشخص است.',fidelity:'deterministic' as const}}if(/PacketsToStream|ConnectionToPackets/.test(type)){next.layer=type.includes('Stream')?'stream':'packet';return {after:next,summary:'لایه ترافیک تبدیل شد',detail:`لایه جدید: ${next.layer}`,fidelity:'deterministic' as const}}if(symbolicTypes.test(type)){next.notes=[...next.notes,`${type} symbolic`];return {after:next,summary:`${type} به‌صورت نمادین اعمال شد`,detail:'این عملیات به رمزنگاری یا شبکه واقعی وابسته است و داده جعلی تولید نشده.',fidelity:'symbolic' as const}}return {after:next,summary:`ترافیک از ${node.data.name} عبور کرد`,detail:getDefinition(type).descriptionFa,fidelity:'deterministic' as const}}
const clone=(state:TrafficState):TrafficState=>({...state,notes:[...state.notes]});
const step=(event:SimulationStep['event'],nodeId:string,edgeId:string|undefined,summary:string,detail:string,fidelity:SimulationStep['fidelity'],before:TrafficState,after:TrafficState):SimulationStep=>({id:`${event}-${nodeId}-${Math.random().toString(36).slice(2,7)}`,event,nodeId,edgeId,summary,detail,fidelity,before:clone(before),after:clone(after)});
const isObject=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

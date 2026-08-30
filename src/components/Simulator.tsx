import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Pause, Play, RotateCcw } from 'lucide-react';
import type { SimulationStep, StudioEdge, StudioNode } from '../types';
import { findPaths, simulatePath } from '../domain/simulator';

export function Simulator({nodes,edges,blocked,incomplete=false,onActiveChange}:{nodes:StudioNode[];edges:StudioEdge[];blocked:boolean;incomplete?:boolean;onActiveChange:(step?:SimulationStep)=>void}){
  const paths=useMemo(()=>findPaths(nodes,edges),[nodes,edges]);const [pathIndex,setPathIndex]=useState(0),[index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const steps=useMemo(()=>simulatePath(paths[pathIndex]??[],nodes,edges),[paths,pathIndex,nodes,edges]);const active=steps[index];
  useEffect(()=>onActiveChange(active),[active,onActiveChange]);
  useEffect(()=>{if(!playing||!steps.length)return;const timer=window.setInterval(()=>setIndex((value)=>{if(value>=steps.length-1){setPlaying(false);return value}return value+1}),900/speed);return()=>clearInterval(timer)},[playing,speed,steps.length]);
  const download=()=>{const blob=new Blob([JSON.stringify({path:paths[pathIndex],steps},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='waterwall-simulation.json';a.click();URL.revokeObjectURL(url)};
  if(blocked)return <div className="sim-blocked"><AlertText/><strong>ابتدا خطاهای گراف را رفع کنید</strong><span>مسیر با اتصال نامعتبر قابل اجرا نیست.</span></div>;
  if(!paths.length)return <div className="sim-blocked"><AlertText/><strong>هنوز مسیر کاملی وجود ندارد</strong><span>یک نود آغازگر را به مقصد متصل کنید.</span></div>;
  return <div className="simulator">
    {incomplete&&<p className="sim-incomplete" role="status">این مسیر هنوز کامل نیست؛ نمایش عبور بر اساس تنظیمات فعلی است.</p>}
    <div className="sim-controls"><button className="play-button" onClick={()=>setPlaying(!playing)}>{playing?<Pause/>:<Play/>}{playing?'توقف':'نمایش عبور'}</button><button className="icon-button" onClick={()=>setIndex(Math.max(0,index-1))} aria-label="مرحله قبل"><ChevronRight/></button><button className="icon-button" onClick={()=>setIndex(Math.min(steps.length-1,index+1))} aria-label="مرحله بعد"><ChevronLeft/></button><button className="icon-button" onClick={()=>{setIndex(0);setPlaying(false)}} aria-label="شروع دوباره"><RotateCcw/></button><label>سرعت <select value={speed} onChange={(event)=>setSpeed(Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label>{paths.length>1&&<label>مسیر <select value={pathIndex} onChange={(event)=>{setPathIndex(Number(event.target.value));setIndex(0)}}>{paths.map((_,i)=><option key={i} value={i}>مسیر {i+1}</option>)}</select></label>}<button className="icon-button" onClick={download} aria-label="دانلود گزارش"><Download/></button></div>
    {active&&<div className="sim-event"><span className={`fidelity ${active.fidelity}`}>{active.fidelity==='symbolic'?'نمایش نمادین':'محاسبه قطعی'}</span><div><small>{active.event} · {index+1}/{steps.length}</small><strong>{active.summary}</strong><p>{active.detail}</p></div></div>}
    <ol className="timeline">{steps.map((item,i)=><li key={item.id} className={i===index?'active':i<index?'done':''}><button onClick={()=>{setIndex(i);setPlaying(false)}}><span>{item.event}</span><small>{item.summary}</small></button></li>)}</ol>
  </div>
}
function AlertText(){return <span className="sim-symbol" aria-hidden="true">↝</span>}

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
export function Sheet({open,title,onClose,children,className=''}:{open:boolean;title:string;onClose:()=>void;children:ReactNode;className?:string}){
  if(!open)return null;
  return <div className="sheet-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}>
    <section className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-grab" />
      <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="بستن"><X/></button></header>
      <div className="sheet-content">{children}</div>
    </section>
  </div>
}

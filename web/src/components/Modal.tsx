import {useLayoutEffect,useRef,type ReactNode} from 'react';
export default function Modal({title,children,onClose,locked=false}:{title:string;children:ReactNode;onClose:()=>void;locked?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{const d=dialog.current!;d.showModal();return()=>d.close();},[]);
  return <dialog ref={dialog} className="modal" aria-label={title} onCancel={e=>{e.preventDefault();if(!locked)onClose();}}><h2>{title}</h2>{children}</dialog>;
}

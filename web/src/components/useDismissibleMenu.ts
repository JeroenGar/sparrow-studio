import {useEffect,type RefObject} from 'react';

export function useDismissibleMenu(ref:RefObject<HTMLDetailsElement|null>) {
  useEffect(()=>{
    const outside=(event:Event)=>{if(ref.current?.open&&!ref.current.contains(event.target as Node))ref.current.open=false;};
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||!ref.current?.open)return;
      event.preventDefault();event.stopPropagation();ref.current.open=false;
      ref.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('focusin',outside);
    document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape,true);};
  },[ref]);
}

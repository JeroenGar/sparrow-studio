import { useEffect, useRef } from 'react';
import { ChevronDown } from './icons';
import { useStudio } from './context';

/** The Import menu of a tab: files from disk, or content from another project. */
export function ImportMenu({
  kind,
  files = true,
}: {
  kind: 'parts' | 'sheets' | 'machines';
  files?: boolean;
}) {
  const { openImport } = useStudio();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const choose = (source: 'files' | 'project') => {
    menu.current!.open = false;
    openImport(kind, source);
  };
  return (
    <details className="menu" ref={menu}>
      <summary className="button small">
        Import <ChevronDown />
      </summary>
      <div className="menu-list">
        {files && <button onClick={() => choose('files')}>Files: DXF, SVG or sparrow JSON…</button>}
        <button onClick={() => choose('project')}>From another project…</button>
      </div>
    </details>
  );
}

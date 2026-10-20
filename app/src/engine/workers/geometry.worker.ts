import { normalizeJob } from '../geometry/normalize';
import { importSparrow } from '../import/sparrow';
import { initializeSVG,traceSVG } from '../import/svg';
import { traceDXF } from '../import/dxf';
import { review,suggestRoles } from '../import/drawing';
import { liveGeometry } from '../geometry/live';
import { exportSVG } from '../export/svg';
import type { GeometryReply, GeometryRequest } from './protocol';

self.onmessage=async({data}: MessageEvent<GeometryRequest>)=>{
  const ids={runId:data.runId,documentRevision:data.documentRevision};
  try {
    let reply: GeometryReply;
    switch(data.type) {
      case 'import': {
        if(!data.files.length || data.files.some(f=>new Blob([f.text]).size>10*1024*1024) || data.files.reduce((n,f)=>n+new Blob([f.text]).size,0)>25*1024*1024) throw Error('Import limit: 10 MiB per file, 25 MiB per batch.');
        if(data.files.some(f=>f.text.trimStart().startsWith('<')))await initializeSVG();
        const tolerance=data.tolerance??.01;
        // Drawings are traced first, so their layers get one set of roles across the files.
        const drawings=data.files.map(f=>{
          const text=f.text.trimStart();
          if(text.startsWith('<'))return traceSVG(f.text,f.name,{scale:data.scale,tolerance,curves:data.curves});
          if(text.startsWith('{'))return undefined;
          if(/^0[ \t]*(?:\r\n|\n|\r)[ \t]*SECTION\b/.test(text)||text.startsWith('AutoCAD Binary DXF'))return traceDXF(f.text,f.name,{scale:data.scale,tolerance,curves:data.curves});
          throw Error(`${f.name}: unsupported file content. Export a closed-contour SVG, supported ASCII DXF, or sparrow instance JSON. Images need tracing and 3D files need projection first.`);
        });
        const layers=[...new Set(drawings.flatMap(d=>d?.layers??[]))].sort();
        const roles={...suggestRoles(layers,data.kind??'parts'),...Object.fromEntries(Object.entries(data.roles??{}).filter(([layer])=>layers.includes(layer)))};
        const reviews=data.files.map((f,i)=>drawings[i]?review(drawings[i]!,roles,{merge:data.merge??true}):importSparrow(f.text,f.name,data.scale));
        const combined={...reviews[0].document,parts:reviews.flatMap(r=>r.document.parts)};
        const document=combined.parts.length?normalizeJob(combined):combined;
        const outlines:Record<string,number>={};
        for(const r of reviews)for(const [layer,count] of Object.entries(r.outlines??{}))outlines[layer]=(outlines[layer]??0)+count;
        reply={...ids,type:'import-review',review:{document,sheets:reviews.flatMap(r=>r.sheets??[]),warnings:reviews.flatMap(r=>r.warnings),issues:reviews.flatMap(r=>r.issues??[]),layers,roles,outlines}};
        break;
      }
      case 'export': reply={...ids,type:'export-result',bundle:exportSVG(data.document,data.result,data.utilization,data.sheets)}; break;
      case 'live-preview':reply={...ids,type:'live-frame',sequence:data.sequence,geometry:data.results.map(result=>liveGeometry(data.document,result))};break;
    }
    self.postMessage(reply);
  } catch(error) { self.postMessage({...ids,type:'error',message:error instanceof Error?error.message:String(error)} satisfies GeometryReply); }
};

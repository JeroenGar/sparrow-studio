import { normalizeJob } from '../geometry/normalize';
import { importSparrow } from '../import/sparrow';
import { importSVG,initializeSVG } from '../import/svg';
import { importDXF } from '../import/dxf';
import { liveGeometry } from '../geometry/live';
import { exportSVG } from '../export/svg';
import type { GeometryReply, GeometryRequest } from './protocol';

self.onmessage=async({data}: MessageEvent<GeometryRequest>)=>{
  const ids={runId:data.runId,documentRevision:data.documentRevision};
  try {
    let reply: GeometryReply;
    switch(data.type) {
      case 'normalize': reply={...ids,type:'normalized',document:normalizeJob(data.document)}; break;
      case 'import': {
        if(!data.files.length || data.files.some(f=>new Blob([f.text]).size>10*1024*1024) || data.files.reduce((n,f)=>n+new Blob([f.text]).size,0)>25*1024*1024) throw Error('Import limit: 10 MiB per file, 25 MiB per batch.');
        if(data.files.some(f=>f.text.trimStart().startsWith('<')))await initializeSVG();
        const reviews=data.files.map(f=>{
          const text=f.text.trimStart();
          if(text.startsWith('<'))return importSVG(f.text,f.name,{scale:data.scale,tolerance:data.tolerance??.01});
          if(text.startsWith('{'))return importSparrow(f.text,f.name,data.scale);
          if(/^0[ \t]*(?:\r\n|\n|\r)[ \t]*SECTION\b/.test(text)||text.startsWith('AutoCAD Binary DXF'))return importDXF(f.text,f.name,{scale:data.scale,tolerance:data.tolerance??.01,enclosed:data.enclosed??'holes',layers:data.layers});
          throw Error(`${f.name}: unsupported file content. Export a closed-contour SVG, supported ASCII DXF, or sparrow instance JSON. Images need tracing and 3D files need projection first.`);
        });
        const combined={...reviews[0].document,parts:reviews.flatMap(r=>r.document.parts)};
        const document=combined.parts.length?normalizeJob(combined):combined;
        reply={...ids,type:'import-review',review:{document,warnings:reviews.flatMap(r=>r.warnings),issues:reviews.flatMap(r=>r.issues??[]),layers:[...new Set(reviews.flatMap(r=>r.layers??[]))].sort()}};
        break;
      }
      case 'export': reply={...ids,type:'export-result',bundle:exportSVG(data.document,data.result)}; break;
      case 'live-preview':reply={...ids,type:'live-frame',sequence:data.sequence,geometry:liveGeometry(data.document,data.result)};break;
    }
    self.postMessage(reply);
  } catch(error) { self.postMessage({...ids,type:'error',message:error instanceof Error?error.message:String(error)} satisfies GeometryReply); }
};

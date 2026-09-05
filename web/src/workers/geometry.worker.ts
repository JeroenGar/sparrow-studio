import { bounds, normalizeDocument, normalizePart,scalePart } from '../geometry/normalize';
import { ellipse } from '../geometry/flatten';
import { newPart,type Ring } from '../model';
import { validate } from '../geometry/validate';
import { importSparrow,localize } from '../import/sparrow';
import { importSVG } from '../import/svg';
import { importDXF } from '../import/dxf';
import { importProject,exportProject } from '../import/project';
import { liveGeometry } from '../geometry/live';
import {libraryDocument} from '../import/library';
import {editSelection} from '../geometry/manipulate';
import {arrangePreparation,labelPoints} from '../geometry/preparation';
import { exportSVG } from '../export/svg';
import { exportProjectArchive } from '../export/zip';
import type { GeometryReply, GeometryRequest } from './protocol';

self.onmessage=({data}: MessageEvent<GeometryRequest>)=>{
  const ids={runId:data.runId,documentRevision:data.documentRevision};
  try {
    let reply: GeometryReply;
    switch(data.type) {
      case 'shape': {
        const dimensions=data.shape==='polygon'?[]:data.shape==='circle'?[data.width]:[data.width,data.height];
        if(!dimensions.every(v=>Number.isFinite(v)&&v>0&&v<=100_000))throw Error('Shape dimensions must be positive and at most 100,000 mm.');
        let outer:Ring;
        if(data.shape==='rectangle')outer=[[0,0],[data.width,0],[data.width,data.height],[0,data.height]];
        else if(data.shape==='circle') {outer=[[data.width, data.width/2]];ellipse([data.width/2,data.width/2],[data.width/2,0],[0,data.width/2],0,2*Math.PI,.01,outer);outer.pop();}
        else outer=data.points ?? [];
        const b=bounds(outer),part=normalizePart(localize({...newPart(outer,data.shape[0].toUpperCase()+data.shape.slice(1)),preparationPosition:[b[0],b[1]],approximationToleranceMm:data.shape==='circle'?.01:0}));
        reply={...ids,type:'part',part};break;
      }
      case 'normalize': reply={...ids,type:'normalized',document:normalizeDocument(data.document)}; break;
      case 'prepare-layout':reply={...ids,type:'normalized',document:arrangePreparation(data.document,data.pinnedIds,data.compact)};break;
      case 'label-points':reply={...ids,type:'label-points',points:labelPoints(data.parts)};break;
      case 'library':reply={...ids,type:'normalized',document:libraryDocument(data.text,data.fileName)};break;
      case 'edit-selection':reply={...ids,type:'normalized',document:editSelection(data.document,data.ids,data.edit,data.refs)};break;
      case 'resize': {
        const part=data.document.parts.find(p=>p.id===data.partId);if(!part)throw Error('Part no longer exists.');
        const b=bounds(part.outer),factor=data.sizeMm/(b[data.axis+2]-b[data.axis]);
        reply={...ids,type:'normalized',document:normalizeDocument({...data.document,parts:data.document.parts.map(p=>p.id===part.id?scalePart(p,factor):p)})};break;
      }
      case 'import': {
        if(!data.files.length || data.files.some(f=>new Blob([f.text]).size>10*1024*1024) || data.files.reduce((n,f)=>n+new Blob([f.text]).size,0)>25*1024*1024) throw Error('Import limit: 10 MiB per file, 25 MiB per batch.');
        const reviews=data.files.map(f=>{
          const text=f.text.trimStart();
          if(text.startsWith('<'))return importSVG(f.text,f.name,{scale:data.scale,tolerance:data.tolerance??.01,enclosed:data.enclosed??'holes'});
          if(text.startsWith('{')) {
            if('schemaVersion' in JSON.parse(text)) {
              if(data.files.length!==1)throw Error('Open a project file on its own. Drawing files can be appended separately.');
              return importProject(text);
            }
            return importSparrow(f.text,f.name,data.scale);
          }
          if(/^0[ \t]*(?:\r\n|\n|\r)[ \t]*SECTION\b/.test(text)||text.startsWith('AutoCAD Binary DXF'))return importDXF(f.text,f.name,{scale:data.scale,tolerance:data.tolerance??.01,enclosed:data.enclosed??'holes',layers:data.layers});
          throw Error(`${f.name}: unsupported file content. Export a closed-contour SVG, supported ASCII DXF, or sparrow instance JSON. Images need tracing and 3D files need projection first.`);
        });
        if(reviews[0].replace) {reply={...ids,type:'import-review',review:reviews[0]};break;}
        const combined={...reviews[0].document,parts:reviews.flatMap(r=>r.document.parts)};
        const document=combined.parts.length?normalizeDocument(combined):combined;
        reply={...ids,type:'import-review',review:{document,warnings:reviews.flatMap(r=>r.warnings),issues:reviews.flatMap(r=>r.issues??[]),layers:[...new Set(reviews.flatMap(r=>r.layers??[]))].sort(),replace:false}};
        break;
      }
      case 'validate': {
        const start=performance.now();
        const validation=validate(data.document,data.result);
        reply={...ids,type:'validation-result',sequence:data.sequence,validation,elapsedMs:performance.now()-start};
        break;
      }
      case 'export': reply={...ids,type:'export-result',bundle:exportSVG(data.document,data.result)}; break;
      case 'save-project': reply={...ids,type:'project-file',text:exportProject(data.document,data.documentRevision,data.result)};break;
      case 'archive': reply={...ids,type:'archive-result',archive:exportProjectArchive(data.document,data.documentRevision,data.result)};break;
      case 'live-preview':reply={...ids,type:'live-frame',sequence:data.sequence,geometry:liveGeometry(data.document,data.result)};break;
    }
    if(reply.type==='archive-result') self.postMessage(reply,[reply.archive.buffer as ArrayBuffer]);
    else self.postMessage(reply);
  } catch(error) { self.postMessage({...ids,type:'error',message:error instanceof Error?error.message:String(error)} satisfies GeometryReply); }
};

import type {Document,Project,Result} from '../model';
import {normalizeDocument} from '../geometry/normalize';
import {validate} from '../geometry/validate';
import {documentPlacements,placementKey,samePlacement,withDocumentPlacements} from '../geometry/placements';
import type {ImportReview} from './sparrow';

export function importProject(text:string):ImportReview {
  const data=JSON.parse(text) as Project;
  if(!data||data.schemaVersion!==1)throw Error('Unsupported project schema version. This app reads version 1 only.');
  if(!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('Invalid project revision.');
  const document=normalizeDocument({name:data.name,parts:data.parts,settings:data.settings,placements:data.placements},true);
  const warnings:string[]=[];let result:Result|undefined;
  if(data.result!==undefined) {
    try {
      if(!document.parts.length)throw Error('Empty projects cannot contain a layout.');
      const saved=data.result;
      if(!saved||saved.documentRevision!==data.revision||typeof saved.solverRevision!=='string'||!/^[a-f0-9]{40}(?:\+[a-z0-9.-]{1,64})?$/i.test(saved.solverRevision)||typeof saved.seed!=='string'||!/^\d{1,20}$/.test(saved.seed)||BigInt(saved.seed)>2n**64n-1n||!Number.isFinite(saved.elapsedSeconds)||saved.elapsedSeconds<0)throw Error('Invalid or mismatched result provenance.');
      // A stored badge has no authority. Check the placements against this file's
      // normalized geometry and the current numeric policy in the worker.
      const candidate:Result={documentRevision:saved.documentRevision,solverRevision:saved.solverRevision,seed:saved.seed,elapsedSeconds:saved.elapsedSeconds,usedLengthMm:saved.usedLengthMm,placements:saved.placements,validation:saved.validation};
      const validation=validate(document,candidate);
      if(validation.status!=='passed')throw Error(validation.errors.join(' '));
      if(data.placements!==undefined) {
        const draft=documentPlacements(document),checked=new Map(candidate.placements.map(placement=>[placementKey(placement),placement]));
        if(draft.length!==checked.size||draft.some(placement=>!samePlacement(placement,checked.get(placementKey(placement))))) throw Error('Saved result does not match the explicit copy positions in this project.');
      }
      result={...candidate,validation};warnings.push('Saved result rechecked successfully.');
    }catch(error){warnings.push(`Saved result was discarded: ${error instanceof Error?error.message:String(error)} The parts and settings can still be loaded.`);}
  }
  return {document:withDocumentPlacements(document,result?.placements),result,warnings,replace:true};
}

export function exportProject(document:Document,revision:number,result?:Result):string {
  const doc=normalizeDocument({name:document.name,parts:document.parts,settings:document.settings,placements:document.placements},true);
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid project revision.');
  if(result&&result.documentRevision!==revision)throw Error('The result belongs to an older document.');
  if(result) {
    if(!doc.parts.length)throw Error('Empty projects cannot contain a layout.');
    result={...result,validation:validate(doc,result)};
    if(result.validation.status!=='passed')throw Error(`Saved layout failed validation: ${result.validation.errors.join(' ')}`);
  }
  const text=JSON.stringify({...doc,schemaVersion:1,revision,...(result?{result}: {})} satisfies Project,null,2);
  if(new Blob([text]).size>10*1024*1024)throw Error('Project exceeds the 10 MiB file limit. Reduce geometry or metadata before saving.');
  const checked=importProject(text);
  if(result&&!checked.result)throw Error(checked.warnings.join(' '));
  return text;
}

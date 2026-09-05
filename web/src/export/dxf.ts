import DxfParser from 'dxf-parser';
import type {ILwpolylineEntity} from 'dxf-parser/dist/entities/lwpolyline';
import type {Document,Result,Ring} from '../model';
import {validate,type WorldPart} from '../geometry/validate';

export function exportDXF(doc:Document,result:Result,world:WorldPart[]):string {
  const polyline=(ring:Ring,layer:string)=>`0\nLWPOLYLINE\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbPolyline\n90\n${ring.length}\n70\n1\n${ring.map(([x,y])=>`10\n${x}\n20\n${y}\n`).join('')}`;
  const layers=['PARTS','HOLES'].map(layer=>`0\nLAYER\n100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord\n2\n${layer}\n70\n0\n62\n7\n6\nCONTINUOUS\n`).join('');
  const entities=world.map(p=>polyline(p.outer,'PARTS')+p.holes.map(h=>polyline(h,'HOLES')).join('')).join('');
  const text=`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2\n${layers}0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
  const parsed=new DxfParser().parseSync(text);
  if(parsed?.header.$INSUNITS!==4)throw Error('Serialized DXF lost its millimeter units.');
  let at=0;
  const ring=(layer:string):Ring=>{
    const entity=parsed.entities[at++] as ILwpolylineEntity;
    if(entity?.type!=='LWPOLYLINE'||!entity.shape||entity.layer!==layer)throw Error('Serialized DXF lost a closed contour or layer.');
    return entity.vertices.map(p=>[p.x,p.y]);
  };
  const reparsed=world.map(p=>({...p,outer:ring('PARTS'),holes:p.holes.map(()=>ring('HOLES'))}));
  const check=validate(doc,result,reparsed);
  if(at!==parsed.entities.length||check.status!=='passed')throw Error(`Serialized DXF failed validation: ${check.errors.join(' ')}`);
  return text;
}

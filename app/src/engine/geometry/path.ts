import {path} from 'd3-path';
import type {Ring} from '../model';

// Closed SVG path data for polygon rings; d3-path also builds the arcs and curves richer contours need.
export function pathData(rings:Ring[]):string {
  const d=path();
  for(const ring of rings){
    ring.forEach(([x,y],i)=>i?d.lineTo(x,y):d.moveTo(x,y));
    d.closePath();
  }
  return d.toString();
}

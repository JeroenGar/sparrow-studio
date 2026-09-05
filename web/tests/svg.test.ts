import {it,expect} from 'vitest';
import {importSVG} from '../src/import/svg';
import {bounds,area} from '../src/geometry/normalize';
import {pointSegmentDistance} from '../src/geometry/validate';
import {bezier} from '../src/geometry/flatten';
import type {Ring} from '../src/model';

const options={scale:1,tolerance:.01,enclosed:'holes' as const};
const svg=(body:string,attrs='width="100mm" height="100mm" viewBox="0 0 100 100"')=>`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
it('resolves physical size and flips the asymmetric L exactly once',()=>{
  const review=importSVG(svg('<path d="M0 0H100V20H20V60H0Z"/>'),'l.svg',options);
  const p=review.document.parts[0];expect(bounds(p.outer)).toEqual([0,0,100,60]);
  expect(p.outer).toContainEqual([20,40]);expect(Math.abs(area(p.outer))).toBe(2800);
});
it('resolves viewBox, affine transforms, and local use references',()=>{
  const review=importSVG(svg('<defs><path id="p" d="M0 0H10V5H0Z"/></defs><use href="#p" transform="translate(20 30) rotate(90) scale(2)"/>'),'use.svg',options);
  const b=bounds(review.document.parts[0].outer);expect(b[2]).toBeCloseTo(10);expect(b[3]).toBeCloseTo(20);
  const px=importSVG(svg('<rect width="96" height="96"/>','width="96px" height="96px"'),'px.svg',options);
  expect(bounds(px.document.parts[0].outer)[2]).toBeCloseTo(25.4);
});
it('honors preserveAspectRatio meet, slice and none without clipping cutting contours',()=>{
  const body='<rect width="10" height="10"/>',attrs='width="100mm" height="100mm" viewBox="0 0 100 50"';
  expect(bounds(importSVG(svg(body,attrs),'meet.svg',options).document.parts[0].outer)).toEqual([0,0,10,10]);
  const slice=importSVG(svg(body,attrs+' preserveAspectRatio="xMaxYMin slice"'),'slice.svg',options);
  expect(bounds(slice.document.parts[0].outer)).toEqual([0,0,20,20]);expect(slice.warnings.join(' ')).toContain('viewport cropping is not applied');
  expect(bounds(importSVG(svg(body,attrs+' preserveAspectRatio="none"'),'none.svg',options).document.parts[0].outer)).toEqual([0,0,10,20]);
  expect(()=>importSVG('<?xml-stylesheet href="remote.css"?>'+svg(body),'style.svg',options)).toThrow('stylesheets');
  expect(()=>importSVG(svg(body,attrs+' xml:base="https://example.com/"'),'base.svg',options)).toThrow('xml:base');
});
it('honors compound evenodd and nonzero holes and separate contour choice',()=>{
  const d='M0 0H40V40H0Z M10 10H30V30H10Z';
  expect(importSVG(svg(`<path fill-rule="evenodd" d="${d}"/>`),'holes.svg',options).document.parts[0].holes).toHaveLength(1);
  expect(importSVG(svg(`<path d="${d}"/>`),'solid.svg',options).document.parts[0].holes).toHaveLength(0);
  const separate=svg('<rect width="40" height="40"/><rect x="10" y="10" width="20" height="20"/>');
  expect(importSVG(separate,'nested.svg',options).document.parts).toHaveLength(1);
  expect(importSVG(separate,'nested.svg',{...options,enclosed:'parts'}).document.parts).toHaveLength(2);
});
it('flattens transformed circles, ellipses, rounded rectangles, and cubics',()=>{
  const bodies=['<circle r="10" cx="20" cy="20" transform="matrix(2 0 1 1 0 0)"/>','<ellipse rx="20" ry="5" cx="30" cy="30"/>','<rect width="30" height="20" rx="5"/>','<path d="M0 0C0 30 30 30 30 0Z"/>'];
  for(const body of bodies){const part=importSVG(svg(body),'curve.svg',options).document.parts[0];expect(part.outer.length).toBeGreaterThan(10);expect(part.approximationToleranceMm).toBe(.01);}
  const ring:Ring=[[0,0]];bezier([[0,0],[100,100],[-100,-100],[1,0]],.01,ring);
  expect(ring.length).toBeGreaterThan(3);
  for(let i=0;i<=1000;i++){const t=i/1000,u=1-t,p:[number,number]=[300*u*u*t-300*u*t*t+t*t*t,300*u*u*t-300*u*t*t];expect(Math.min(...ring.slice(1).map((b,j)=>pointSegmentDistance(p,ring[j],b)))).toBeLessThanOrEqual(.01000001);}
});
it('accepts stroke-only closed paths and explicitly rejects open paths',()=>{
  expect(importSVG(svg('<path fill="none" stroke="black" d="M0 0H10V10H0Z"/>'),'stroke.svg',options).document.parts).toHaveLength(1);
  expect(()=>importSVG(svg('<path d="M0 0H10V10"/>'),'open.svg',options)).toThrow('Open path');
});
it.each(['<script/>','<foreignObject/>','<rect width="10" height="10" onload="alert(1)"/>','<use href="https://example.com/a.svg#b"/>','<use id="cycle" href="#cycle"/>','<svg><rect width="1" height="1"/></svg>','<style>rect { width:10px }</style>'])('rejects unsafe or unsupported markup %s',body=>{
  expect(()=>importSVG(svg(body),'bad.svg',options)).toThrow();
});
it('rejects entities and limits subdivision without silently coarsening',()=>{
  expect(()=>importSVG('<!DOCTYPE svg>'+svg('<rect width="1" height="1"/>'),'bad.svg',options)).toThrow('DOCTYPE');
  expect(()=>importSVG(svg('<circle r="40"/>'),'huge.svg',{...options,tolerance:1e-12})).toThrow('5,000');
});

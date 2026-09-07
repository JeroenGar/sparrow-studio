import './svg-wasm';
import {it,expect} from 'vitest';
import {importSVG} from '../src/import/svg';
import {bounds,area} from '../src/geometry/normalize';
import {pointSegmentDistance} from '../src/geometry/validate';
import {bezier} from '../src/geometry/flatten';
import type {Ring} from '../src/model';

const options={scale:1,tolerance:.01};
const svg=(body:string,attrs='width="100mm" height="100mm" viewBox="0 0 100 100"')=>`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
it('resolves stylesheet classes, inherited paint, hidden geometry and symbol instances',()=>{
  const body=`<style>.outline { fill:none; stroke:black; stroke-linejoin:round } .hidden { display:none } .hole { fill-rule:evenodd }</style>
    <defs><symbol id="part" viewBox="0 0 10 10" overflow="visible"><rect width="10" height="10"/></symbol></defs>
    <rect class="hidden" width="100" height="100"/>
    <g class="outline"><use href="#part" width="10" height="10"/><use href="#part" x="20" width="20" height="20"/></g>
    <path class="hole" d="M50 0H90V40H50Z M60 10H80V30H60Z"/>`;
  const parts=importSVG(svg(body),'styles.svg',options).document.parts;
  expect(parts).toHaveLength(3);
  expect(parts.map(p=>bounds(p.outer)[2])).toEqual([10,20,40].map(v=>expect.closeTo(v,4)));
  expect(parts.map(p=>p.holes.length)).toEqual([0,0,1]);
});
it('resolves nested viewports and reports clipping instead of silently changing outlines',()=>{
  const nested=svg('<svg x="20" y="20" width="40" height="20" viewBox="0 0 10 5" overflow="visible"><rect width="10" height="5"/></svg>');
  expect(bounds(importSVG(nested,'nested.svg',options).document.parts[0].outer).slice(2)).toEqual([expect.closeTo(40,4),expect.closeTo(20,4)]);
  const clipped=svg('<defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs><style>.cut {clip-path:url(#clip)}</style><rect class="cut" width="10" height="10"/>');
  expect(()=>importSVG(clipped,'clipped.svg',options)).toThrow('Clipping, masks and filters');
});
it('accepts Illustrator presentation styles without importing invisible canvas bounds',()=>{
  const review=importSVG(svg('<rect width="100" height="100" style="fill:none"/><g fill="none"><rect width="90" height="90"/><rect width="10" height="20" style="stroke:black;stroke-linejoin:round"/><rect x="30" width="10" height="20" style="fill:black"/></g>',
    'viewBox="0 0 100 100" style="enable-background:new 0 0 100 100"'),'illustrator.svg',options);
  expect(review.document.parts).toHaveLength(2);
  expect(review.document.parts.map(p=>bounds(p.outer).slice(2))).toEqual([[10,20],[10,20]]);
  expect(review.document.parts.every(p=>p.holes.length===0)).toBe(true);
  expect(bounds(importSVG(svg('<rect id="part" width="10" height="10" style="transform:scale(2)"/>'),'css.svg',options).document.parts[0].outer).slice(2)).toEqual([expect.closeTo(20,4),expect.closeTo(20,4)]);
});
it('resolves physical size and flips the asymmetric L exactly once',()=>{
  const review=importSVG(svg('<path d="M0 0H100V20H20V60H0Z"/>'),'l.svg',options);
  const p=review.document.parts[0];expect(bounds(p.outer)).toEqual([0,0,expect.closeTo(100,4),expect.closeTo(60,4)]);
  expect(p.outer).toContainEqual([expect.closeTo(20,4),expect.closeTo(40,4)]);expect(Math.abs(area(p.outer))).toBeCloseTo(2800,2);
});
it('resolves viewBox, affine transforms, and local use references',()=>{
  const review=importSVG(svg('<defs><path id="p" d="M0 0H10V5H0Z"/></defs><use href="#p" transform="translate(20 30) rotate(90) scale(2)"/>'),'use.svg',options);
  const b=bounds(review.document.parts[0].outer);expect(b[2]).toBeCloseTo(10);expect(b[3]).toBeCloseTo(20);
  const px=importSVG(svg('<rect width="96" height="96"/>','width="96px" height="96px"'),'px.svg',options);
  expect(bounds(px.document.parts[0].outer)[2]).toBeCloseTo(25.4);
});
it('expands repeated and nested use references with independent transforms',()=>{
  const review=importSVG(svg('<defs><path id="part" d="M0 0H10V5H0Z"/><g id="pair"><use href="#part"/><use href="#part" x="20"/></g></defs><use href="#pair" transform="translate(10 10)"/><use href="#pair" transform="translate(70 10) rotate(90) scale(2)"/>'),'repeated.svg',options);
  expect(review.document.parts).toHaveLength(4);
  expect(review.document.parts.map(p=>bounds(p.outer).slice(2))).toEqual([[10,5],[10,5],[10,20],[10,20]].map(pair=>pair.map(v=>expect.closeTo(v,4))));
  expect(new Set(review.document.parts.map(p=>p.id)).size).toBe(4);
});
it('honors preserveAspectRatio meet, slice and none without clipping cutting contours',()=>{
  const body='<rect width="10" height="10"/>',attrs='width="100mm" height="100mm" viewBox="0 0 100 50"';
  expect(bounds(importSVG(svg(body,attrs),'meet.svg',options).document.parts[0].outer)).toEqual([0,0,expect.closeTo(10,4),expect.closeTo(10,4)]);
  const slice=importSVG(svg(body,attrs+' preserveAspectRatio="xMaxYMin slice"'),'slice.svg',options);
  expect(bounds(slice.document.parts[0].outer)).toEqual([0,0,expect.closeTo(20,4),expect.closeTo(20,4)]);expect(slice.warnings.join(' ')).toContain('viewport cropping is not applied');
  expect(bounds(importSVG(svg(body,attrs+' preserveAspectRatio="none"'),'none.svg',options).document.parts[0].outer)).toEqual([0,0,expect.closeTo(10,4),expect.closeTo(20,4)]);
  expect(()=>importSVG('<?xml-stylesheet href="remote.css"?>'+svg(body),'style.svg',options)).toThrow('stylesheets');
  expect(()=>importSVG(svg(body,attrs+' xml:base="https://example.com/"'),'base.svg',options)).toThrow('xml:base');
});
it('honors compound fill rules and keeps different SVG paths independent',()=>{
  const d='M0 0H40V40H0Z M10 10H30V30H10Z';
  expect(importSVG(svg(`<path fill-rule="evenodd" d="${d}"/>`),'holes.svg',options).document.parts[0].holes).toHaveLength(1);
  expect(importSVG(svg(`<path d="${d}"/>`),'solid.svg',options).document.parts[0].holes).toHaveLength(0);
  const separate=svg('<rect width="40" height="40"/><rect x="10" y="10" width="20" height="20"/>');
  expect(importSVG(separate,'nested.svg',options).document.parts).toHaveLength(2);
});
it.each([30,40])('imports overlapping or touching artwork separately while preserving compound holes (x=%s)',x=>{
  const body=`<path fill-rule="evenodd" d="M0 0H40V40H0Z M10 10H20V20H10Z"/><rect x="${x}" width="40" height="40"/>`;
  const review=importSVG(svg(body),'artwork.svg',options);
  expect(review.document.parts).toHaveLength(2);
  expect(review.document.parts.map(p=>p.holes.length)).toEqual([1,0]);
  expect(()=>importSVG(svg('<path d="M0 0L20 20L0 20L20 0Z"/>'),'crossed.svg',options)).toThrow();
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
it.each(['<script/>','<foreignObject/>','<rect width="10" height="10" onload="alert(1)"/>','<use href="https://example.com/a.svg#b"/>','<use id="cycle" href="#cycle"/>'])('rejects unsafe or unsupported markup %s',body=>{
  expect(()=>importSVG(svg(body),'bad.svg',options)).toThrow();
});
it('rejects entities and limits subdivision without silently coarsening',()=>{
  expect(()=>importSVG('<!DOCTYPE svg>'+svg('<rect width="1" height="1"/>'),'bad.svg',options)).toThrow('DOCTYPE');
  expect(()=>importSVG(svg('<circle r="40"/>'),'huge.svg',{...options,tolerance:1e-12})).toThrow('5,000');
});

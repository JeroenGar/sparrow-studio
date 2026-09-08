import {jsPDF} from 'jspdf';
import 'svg2pdf.js';

export async function exportPDF(svg:string):Promise<ArrayBuffer> {
  const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
  const width=parseFloat(root.getAttribute('width')!),height=parseFloat(root.getAttribute('height')!);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Invalid PDF page dimensions.');
  // PDF pages are limited to 14,400 points; UserUnit preserves physical scale for larger layouts.
  const userUnit=Math.max(1,Math.max(width,height)/5080);
  const pageWidth=width/userUnit,pageHeight=height/userUnit;
  root.removeAttribute('style');
  // svg2pdf does not render links nested inside SVG text.
  root.querySelectorAll('text a').forEach(link=>link.replaceWith(root.ownerDocument.createTextNode(link.textContent??'')));
  const pdf=new jsPDF({orientation:width>=height?'landscape':'portrait',unit:'mm',format:[pageWidth,pageHeight],userUnit,compress:true,floatPrecision:16});
  pdf.setProperties({title:root.querySelector('title')?.textContent??'sparrow/studio',creator:'sparrow/studio'});
  await pdf.svg(root,{x:0,y:0,width:pageWidth,height:pageHeight});
  return pdf.output('arraybuffer');
}

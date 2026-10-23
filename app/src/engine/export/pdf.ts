import {jsPDF} from 'jspdf';
import 'svg2pdf.js';

/** A PDF with one page per SVG, each at the SVG's physical size. */
export async function exportPDF(svgs:string[]):Promise<ArrayBuffer> {
  const pages=svgs.map(svg=>{
    const root=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
    const width=parseFloat(root.getAttribute('width')!),height=parseFloat(root.getAttribute('height')!);
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Invalid PDF page dimensions.');
    root.removeAttribute('style');
    // svg2pdf does not render links nested inside SVG text.
    root.querySelectorAll('text a').forEach(link=>link.replaceWith(root.ownerDocument.createTextNode(link.textContent??'')));
    return {root,width,height};
  });
  if(!pages.length)throw Error('Nothing to put in the PDF.');
  // PDF pages are limited to 14,400 points; UserUnit, one for the document, preserves physical scale for larger layouts.
  const userUnit=Math.max(1,...pages.map(page=>Math.max(page.width,page.height)/5080));
  const size=(page:typeof pages[number]):[number,number]=>[page.width/userUnit,page.height/userUnit];
  const orientation=(page:typeof pages[number])=>page.width>=page.height?'landscape' as const:'portrait' as const;
  const pdf=new jsPDF({orientation:orientation(pages[0]),unit:'mm',format:size(pages[0]),userUnit,compress:true,floatPrecision:16});
  pdf.setProperties({title:pages[0].root.querySelector('title')?.textContent??'sparrow studio',creator:'sparrow studio'});
  for(const [i,page] of pages.entries()) {
    if(i)pdf.addPage(size(page),orientation(page));
    const [w,h]=size(page);
    await pdf.svg(page.root,{x:0,y:0,width:w,height:h});
  }
  return pdf.output('arraybuffer');
}

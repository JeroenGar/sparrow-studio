export function gridStep(target:number):number {
  const power=10**Math.floor(Math.log10(target)),fraction=target/power;
  return (fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power;
}
export function coordinateGrid(camera:{x:number;y:number;w:number;h:number},width:number,height:number,unitMm:number) {
  const mmPerPixel=Math.max(camera.w/width,camera.h/height);
  const left=camera.x-(width*mmPerPixel-camera.w)/2,top=camera.y-(height*mmPerPixel-camera.h)/2;
  const major=gridStep(70*mmPerPixel/unitMm),mantissa=major/10**Math.floor(Math.log10(major));
  const subdivisions=Math.abs(mantissa-2)<1e-8?4:5,minor=major/subdivisions;
  function ticks(min:number,max:number) {
    const start=Math.ceil(min/unitMm/minor),end=Math.floor(max/unitMm/minor);
    return Array.from({length:Math.max(0,end-start+1)},(_,offset)=>{
      const index=start+offset,value=Number((index*minor).toPrecision(12));
      return {mm:value*unitMm,value,major:index%subdivisions===0};
    });
  }
  return {left,top,mmPerPixel,major,x:ticks(left,left+width*mmPerPixel),y:ticks(-top-height*mmPerPixel,-top)};
}

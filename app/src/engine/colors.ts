// Brick tints part colours: light tints of the studio label's brick, apricot and butter, with sage,
// slate and mauve in turn so a full sheet never turns all red. Each colour has a darker shade for
// patterns.
export const colors=['#e8aaa0','#c3d6ae','#f2c9a4','#b3bed4','#efdfa6','#d1b1cb','#a9c8c4','#dbcab0'];
const darker=(hex:string)=>'#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*.58).toString(16).padStart(2,'0')).join('');
export const shades=colors.map(darker);

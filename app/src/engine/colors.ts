// Earth part colours: clay, ochre, sage, moss and dusty blue, warm and cool in turn, so neighbours in
// a list never look alike. Each colour has a darker shade for patterns.
export const colors=['#d9a084','#aec59a','#e2c27a','#9fb4c6','#c9a99a','#93ad8c','#e5b49a','#b9a1b8','#d6c4a2','#a7b98a'];
const darker=(hex:string)=>'#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*.58).toString(16).padStart(2,'0')).join('');
export const shades=colors.map(darker);

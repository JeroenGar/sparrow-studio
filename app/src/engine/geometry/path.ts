import type {Ring} from '../model';
export const pathData=(rings:Ring[])=>rings.map(r=>`M${r.map(p=>p.join(',')).join('L')}Z`).join('');

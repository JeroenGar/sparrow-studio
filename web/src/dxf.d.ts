declare module 'dxf/lib/parseString' {
  export default function parseString(text: string): unknown;
}
declare module 'dxf/lib/util/bSpline' {
  export default function bSpline(t: number, degree: number, points: number[][], knots: number[]): number[];
}

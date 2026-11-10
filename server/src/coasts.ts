// Cosmetic map metadata, independent of economy state and event-log replay.
export interface CoastDirection { dx: number; dy: number }
interface Position { id: number; x: number; y: number; coastDirection?: CoastDirection }
interface Route { a: number; b: number }

function unit(vector?: CoastDirection): CoastDirection | undefined {
  if (!vector || !Number.isFinite(vector.dx) || !Number.isFinite(vector.dy)) return;
  const length = Math.hypot(vector.dx, vector.dy);
  if (length < 1e-6) return;
  return { dx: vector.dx / length, dy: vector.dy / length };
}

export function addCoasts<T extends Position>(
  ports: readonly T[], routes: readonly Route[],
  overrides: ReadonlyMap<number, CoastDirection> = new Map()
): Array<T & { coastDirection: CoastDirection }> {
  const byId = new Map(ports.map(p => [p.id, p]));
  const bearings = new Map(ports.map(p => [p.id, [] as number[]]));
  for (const route of routes) {
    const a = byId.get(route.a), b = byId.get(route.b);
    if (!a || !b) continue;
    bearings.get(a.id)!.push(Math.atan2(b.y-a.y, b.x-a.x));
    bearings.get(b.id)!.push(Math.atan2(a.y-b.y, a.x-b.x));
  }
  return ports.map(p => {
    let direction = unit(overrides.get(p.id)) ?? unit(p.coastDirection);
    if (!direction) {
      const angles = bearings.get(p.id)!.sort((a,b) => a-b);
      let angle = p.id * 2.399963229728653, largest = -1;
      for (let i=0; i<angles.length; i++) {
        const end = i+1 < angles.length ? angles[i+1] : angles[0]+Math.PI*2;
        const gap = end-angles[i];
        if (gap > largest) { largest=gap; angle=angles[i]+gap/2; }
      }
      // A lane between OTHER ports can pass close to this harbour too.
      // Choose an alternative inland bearing if that lane would erase its shore.
      const smooth = (t:number) => { t=Math.max(0,Math.min(1,t)); return t*t*(3-2*t); };
      const clearance = (bearing:number) => {
        const x=p.x+Math.cos(bearing)*6, y=p.y+Math.sin(bearing)*6;
        let result=6;
        for (const route of routes) {
          const a=byId.get(route.a), b=byId.get(route.b);
          if(!a||!b) continue;
          const dx=b.x-a.x, dy=b.y-a.y, length=Math.hypot(dx,dy);
          if(!length) continue;
          const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(length*length)));
          const d=Math.hypot(x-a.x-t*dx,y-a.y-t*dy);
          const width=9*smooth(Math.min(t,1-t)*length/16)*smooth(6/12);
          result=Math.min(result,d-width);
        }
        return result;
      };
      if(clearance(angle)<1.5) {
        const preferred=angle;
        let best=-Infinity;
        for(let step=0;step<72;step++) {
          const candidate=preferred+step*Math.PI*2/72;
          const score=clearance(candidate)+.001*Math.cos(candidate-preferred);
          if(score>best) { best=score; angle=candidate; }
        }
      }
      direction = { dx: Math.cos(angle), dy: Math.sin(angle) };
    }
    return { ...p, coastDirection: direction };
  });
}

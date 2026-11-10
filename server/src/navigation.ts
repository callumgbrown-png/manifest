import { createHash } from 'node:crypto';
import type { MapData } from './engine.js';

export interface Point { x:number; y:number }
export interface Grid { width:number; height:number; cellSize:number; cols:number; rows:number; water:Uint8Array }
export interface Terrain extends Omit<Grid,'water'> { waterBase64:string }
export interface NavigationMap extends MapData { seed:number; navigationId:string; terrain?:Terrain }
export const PARAMETERS={cellSize:4, largeScale:420, mediumScale:190, detailScale:80, threshold:.08, coastRadius:48};
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const smooth=(x:number)=>{x=clamp(x);return x*x*(3-2*x);};
function hash(x:number,y:number,s:number) { let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(s,1442695041);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295; }
function noise(x:number,y:number,s:number) {
  const a=Math.floor(x),b=Math.floor(y),u=smooth(x-a),v=smooth(y-b);
  const n=hash(a,b,s),m=hash(a+1,b,s),p=hash(a,b+1,s),q=hash(a+1,b+1,s);
  return ((n+(m-n)*u)*(1-v)+(p+(q-p)*u)*v)*2-1;
}
export function indexAt(g:Grid,p:Point) {
  const x=Math.floor(p.x/g.cellSize),y=Math.floor(p.y/g.cellSize);
  if(x<0||y<0||x>=g.cols||y>=g.rows) throw new Error('Port outside navigation grid');
  return y*g.cols+x;
}
const centre=(g:Grid,i:number):Point=>({x:(i%g.cols+.5)*g.cellSize,y:(Math.floor(i/g.cols)+.5)*g.cellSize});
const wet=(g:Grid,x:number,y:number)=>x>=0&&y>=0&&x<g.cols&&y<g.rows&&g.water[y*g.cols+x]===1;
interface Entry {i:number;g:number;f:number}
class Heap {
  a:Entry[]=[];
  push(e:Entry){let i=this.a.length;this.a.push(e);while(i){const p=(i-1)>>1;if(this.a[p].f<=e.f)break;this.a[i]=this.a[p];i=p;}this.a[i]=e;}
  pop(){const first=this.a[0],last=this.a.pop()!;if(this.a.length){let i=0;while(true){let c=i*2+1;if(c>=this.a.length)break;if(c+1<this.a.length&&this.a[c+1].f<this.a[c].f)c++;if(this.a[c].f>=last.f)break;this.a[i]=this.a[c];i=c;}this.a[i]=last;}return first;}
}

export function generateTerrain(ports:MapData['ports'],seed:number,width=1000,height=700):Grid {
  const cellSize=PARAMETERS.cellSize,cols=width/cellSize,rows=height/cellSize;
  if(!Number.isInteger(cols)||!Number.isInteger(rows))throw new Error('Grid dimensions must divide cell size');
  const water=new Uint8Array(cols*rows),grid={width,height,cellSize,cols,rows,water};
  for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){
    const x=(gx+.5)*cellSize,y=(gy+.5)*cellSize;
    let elevation=noise(x/PARAMETERS.largeScale,y/PARAMETERS.largeScale,seed)*.72
      +noise(x/PARAMETERS.mediumScale,y/PARAMETERS.mediumScale,seed+1)*.22
      +noise(x/PARAMETERS.detailScale,y/PARAMETERS.detailScale,seed+2)*.06-PARAMETERS.threshold;
    let nearest=Infinity,port:MapData['ports'][number]|undefined;
    for(const p of ports){const d=Math.hypot(x-p.x,y-p.y);if(d<nearest){nearest=d;port=p;}}
    if(port&&nearest<PARAMETERS.coastRadius){
      const v=port.coastDirection??{dx:1,dy:0},length=Math.hypot(v.dx,v.dy);
      if(!Number.isFinite(length)||length<1e-6)throw new Error('Invalid coast vector');
      const local=((x-port.x)*v.dx+(y-port.y)*v.dy)/length/64,t=smooth(nearest/PARAMETERS.coastRadius);
      elevation=local*(1-t)+elevation*t;
    }
    water[gy*cols+gx]=elevation<=0?1:0;
  }
  for(const p of ports)water[indexAt(grid,p)]=1;
  connectHarbours(grid,ports);
  return grid;
}

// Join landlocked harbour pockets to the main ocean using least-cost, narrow
// channels. This happens only for disconnected water, never for every trade lane.
function connectHarbours(grid:Grid,ports:MapData['ports']) {
  const n=grid.water.length,seen=new Uint8Array(n);let ocean:number[]=[];
  for(let seed=0;seed<n;seed++)if(grid.water[seed]&&!seen[seed]){
    const q=[seed];seen[seed]=1;
    for(let h=0;h<q.length;h++){
      const i=q[h],x=i%grid.cols,y=Math.floor(i/grid.cols);
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,j=ny*grid.cols+nx;if(wet(grid,nx,ny)&&!seen[j]){seen[j]=1;q.push(j);}}
    }
    if(q.length>ocean.length)ocean=q;
  }
  if(!ocean.length)throw new Error('Terrain has no ocean');
  const connected=new Uint8Array(n);for(const i of ocean)connected[i]=1;
  const flood=(seed:number)=>{const q=[seed];connected[seed]=1;for(let h=0;h<q.length;h++){const i=q[h],x=i%grid.cols,y=Math.floor(i/grid.cols);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,j=ny*grid.cols+nx;if(wet(grid,nx,ny)&&!connected[j]){connected[j]=1;q.push(j);}}}};
  for(const port of ports){
    const start=indexAt(grid,port);if(connected[start])continue;
    const cost=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),open=new Heap();
    cost[start]=0;open.push({i:start,g:0,f:0});let end=-1;
    while(open.a.length){
      const cur=open.pop();if(cur.g!==cost[cur.i])continue;
      if(connected[cur.i]){end=cur.i;break;}
      const x=cur.i%grid.cols,y=Math.floor(cur.i/grid.cols);
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=grid.cols||ny>=grid.rows)continue;
        const j=ny*grid.cols+nx,g=cur.g+(grid.water[j]?1:35);
        if(g<cost[j]){cost[j]=g;prev[j]=cur.i;open.push({i:j,g,f:g});}
      }
    }
    if(end<0)throw new Error('Cannot connect harbour '+port.id);
    for(let i=end;i!==-1;i=prev[i])grid.water[i]=1;
    flood(start);
  }
}

export function findWaterPath(grid:Grid,start:Point,goal:Point):Point[]|null {
  const a=indexAt(grid,start),b=indexAt(grid,goal);if(!grid.water[a]||!grid.water[b])return null;
  const g=new Float64Array(grid.water.length).fill(Infinity),prev=new Int32Array(grid.water.length).fill(-1),open=new Heap();
  const h=(i:number)=>Math.hypot(i%grid.cols-b%grid.cols,Math.floor(i/grid.cols)-Math.floor(b/grid.cols));
  g[a]=0;open.push({i:a,g:0,f:h(a)});
  while(open.a.length){
    const cur=open.pop();if(cur.g!==g[cur.i])continue;
    if(cur.i===b){const ids:number[]=[];for(let i=b;i!==-1;i=prev[i])ids.push(i);return [start,...ids.reverse().map(i=>centre(grid,i)),goal];}
    const x=cur.i%grid.cols,y=Math.floor(cur.i/grid.cols);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;
      if(!wet(grid,nx,ny)||(dx&&dy&&(!wet(grid,x+dx,y)||!wet(grid,x,y+dy))))continue;
      const i=ny*grid.cols+nx,next=cur.g+Math.hypot(dx,dy);
      if(next<g[i]){g[i]=next;prev[i]=cur.i;open.push({i,g:next,f:next+h(i)});}
    }
  }
  return null;
}

// Supercover line of sight, including the two side cells at a corner crossing.
export function canSailStraight(grid:Grid,a:Point,b:Point) {
  const size=grid.cellSize;let x=Math.floor(a.x/size),y=Math.floor(a.y/size);
  const ex=Math.floor(b.x/size),ey=Math.floor(b.y/size),dx=b.x-a.x,dy=b.y-a.y,sx=Math.sign(dx),sy=Math.sign(dy);
  const tx=dx?size/Math.abs(dx):Infinity,ty=dy?size/Math.abs(dy):Infinity;
  let nx=dx?(((sx>0?x+1:x)*size)-a.x)/dx:Infinity,ny=dy?(((sy>0?y+1:y)*size)-a.y)/dy:Infinity;
  for(let guard=0;guard<grid.cols+grid.rows+4;guard++){
    if(!wet(grid,x,y))return false;if(x===ex&&y===ey)return true;
    // Once an axis reaches the endpoint cell, don't step beyond that cell.
    const cx=x===ex?Infinity:nx,cy=y===ey?Infinity:ny;
    if(Math.abs(cx-cy)<1e-10){if(!wet(grid,x+sx,y)||!wet(grid,x,y+sy))return false;x+=sx;y+=sy;nx+=tx;ny+=ty;}
    else if(cx<cy){x+=sx;nx+=tx;}else{y+=sy;ny+=ty;}
  }
  return false;
}

export function simplifyWaterPath(grid:Grid,path:Point[]) {
  if(path.length<2)return path;
  const result=[path[0]];let anchor=0;
  while(anchor<path.length-1){
    let far=anchor+1;
    for(let j=anchor+2;j<path.length;j++){if(!canSailStraight(grid,path[anchor],path[j]))break;far=j;}
    if(!canSailStraight(grid,path[anchor],path[far]))throw new Error('Unsafe path segment');
    result.push(path[far]);anchor=far;
  }
  return result;
}
export function serializeGrid(grid:Grid):Terrain {const {water,...rest}=grid;return {...rest,waterBase64:Buffer.from(water).toString('base64')};}
export function decodeGrid(terrain:Terrain):Grid {const {waterBase64,...rest}=terrain;return {...rest,water:Uint8Array.from(Buffer.from(waterBase64,'base64'))};}
export function generateNavigation(map:MapData&{seed?:number}):NavigationMap {
  const seed=map.seed??7,grid=generateTerrain(map.ports,seed),byId=new Map(map.ports.map(p=>[p.id,p]));
  const routes=map.routes.map(route=>{
    const a=byId.get(route.a)!,b=byId.get(route.b)!,raw=findWaterPath(grid,a,b);
    if(!raw)throw new Error(`Disconnected ports ${a.id}-${b.id}`);
    const waypoints=simplifyWaterPath(grid,raw);
    let distance=0;for(let i=1;i<waypoints.length;i++)distance+=Math.hypot(waypoints[i].x-waypoints[i-1].x,waypoints[i].y-waypoints[i-1].y);
    return {...route,distance,waypoints};
  });
  const value={...map,seed,terrain:serializeGrid(grid),routes};
  return {...value,navigationId:createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20)};
}

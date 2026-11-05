import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {addCoasts} from '../src/coasts.ts';
import {generateNavigation,decodeGrid,findWaterPath,canSailStraight,simplifyWaterPath,type Grid} from '../src/navigation.ts';
const source=JSON.parse(readFileSync(new URL('../../config/map.json',import.meta.url),'utf8'));
const map={...source,ports:addCoasts(source.ports,source.routes)};
let nav:ReturnType<typeof generateNavigation>;
test('real map: navigable segmented routes, common geometry distances, unchanged ports',()=>{
  const before=JSON.stringify(map),started=performance.now();nav=generateNavigation(map);
  assert.equal(JSON.stringify(map),before);
  const grid=decodeGrid(nav.terrain!);
  let curved=0;
  for(const route of nav.routes){
    const points=route.waypoints!;
    assert.deepEqual(points[0],map.ports[route.a]);
    assert.deepEqual(points.at(-1),map.ports[route.b]);
    let length=0;
    for(let i=1;i<points.length;i++){
      assert.ok(canSailStraight(grid,points[i-1],points[i]),`Unsafe route ${route.a}-${route.b}`);
      assert.ok(canSailStraight(grid,points[i],points[i-1]),'Reversed route unsafe');
      length+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);
    }
    assert.ok(Math.abs(length-route.distance)<1e-9);
    if(points.length>2)curved++;
  }
  assert.ok(curved>0,'Routes must bend around land');
  const land=grid.water.reduce((sum,x)=>sum+(x===0?1:0),0)/grid.water.length;
  assert.ok(land>.1&&land<.85,`Unexpected land coverage ${land}`);
  const seen=new Uint8Array(grid.water.length),components:number[]=[];
  for(let seed=0;seed<seen.length;seed++)if(!seen[seed]&&!grid.water[seed]){
    const q=[seed];seen[seed]=1;
    for(let h=0;h<q.length;h++){const i=q[h],x=i%grid.cols,y=Math.floor(i/grid.cols);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,j=ny*grid.cols+nx;if(nx>=0&&ny>=0&&nx<grid.cols&&ny<grid.rows&&!grid.water[j]&&!seen[j]){seen[j]=1;q.push(j);}}}
    components.push(q.length);
  }
  components.sort((a,b)=>b-a);
  assert.ok(components[0]>1000,'Expected a large shared landmass');
  console.log(`Landmasses: ${components.filter(n=>n>100).length} substantial, largest ${components[0]} cells`);
  console.log(`Navigation: ${(performance.now()-started).toFixed(0)}ms, ${curved}/${nav.routes.length} bent routes, ${(land*100).toFixed(1)}% land`);
});
test('client movement and headings follow server waypoints in both directions',()=>{
  const scope:any={};runInNewContext(readFileSync(new URL('../public/navigation-layer.js',import.meta.url),'utf8'),scope);
  const api=scope.ManifestNavigation,index=api.routeIndex(nav.routes,nav.ports),grid=decodeGrid(nav.terrain!);
  for(const route of nav.routes)for(const [a,b]of [[route.a,route.b],[route.b,route.a]]){
    const geometry=api.voyage([a,b],index);
    assert.ok(Math.abs(geometry.total-route.distance)<1e-8);
    for(let i=0;i<=100;i++){
      const p=api.position(geometry,i/100);
      assert.equal(grid.water[Math.floor(p.y/4)*grid.cols+Math.floor(p.x/4)],1,'Ship crossed land');
      assert.ok(Number.isFinite(p.angle));
    }
  }
});
test('generation and serialized terrain are deterministic',()=>{
  assert.deepEqual(generateNavigation(map),nav);
  assert.equal(Buffer.from(decodeGrid(nav.terrain!).water).toString('base64'),nav.terrain!.waterBase64);
});
test('A* detours around land and cannot cut diagonal corners',()=>{
  const grid:Grid={width:5,height:5,cellSize:1,cols:5,rows:5,water:new Uint8Array(25).fill(1)};
  grid.water[7]=0;grid.water[12]=0;grid.water[17]=0;
  const a={x:.5,y:2.5},b={x:4.5,y:2.5};
  assert.equal(canSailStraight(grid,a,b),false);
  const path=simplifyWaterPath(grid,findWaterPath(grid,a,b)!);
  assert.ok(path.length>2);
  for(let i=1;i<path.length;i++)assert.ok(canSailStraight(grid,path[i-1],path[i]));
  const corner:Grid={width:2,height:2,cellSize:1,cols:2,rows:2,water:Uint8Array.from([1,0,0,1])};
  assert.equal(findWaterPath(corner,{x:.5,y:.5},{x:1.5,y:1.5}),null);
  assert.equal(canSailStraight(corner,{x:.5,y:.5},{x:1.5,y:1.5}),false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {addCoasts} from '../src/coasts.ts';

const map=JSON.parse(readFileSync(new URL('../../config/map.json',import.meta.url),'utf8'));
const scope: any={};
runInNewContext(readFileSync(new URL('../public/island-layer.js',import.meta.url),'utf8'),scope);
const terrain=scope.ManifestIslands;

test('coast metadata is deterministic, normalized, and leaves port coordinates unchanged',()=>{
  const before=JSON.stringify(map), ports=addCoasts(map.ports,map.routes);
  assert.equal(JSON.stringify(map),before);
  assert.deepEqual(ports,addCoasts(map.ports,map.routes));
  for(const p of ports) {
    assert.ok(Math.abs(Math.hypot(p.coastDirection.dx,p.coastDirection.dy)-1)<1e-12);
  }
  const override=addCoasts(map.ports,map.routes,new Map([[0,{dx:-4,dy:0}]]));
  assert.deepEqual(override[0].coastDirection,{dx:-1,dy:0});
});

test('all 40 real ports stay on a coastline, with water on their seaward side',()=>{
  const ports=addCoasts(map.ports,map.routes), sampler=terrain.createSampler(ports,map.routes,map.seed);
  for(const p of ports) {
    assert.ok(Math.abs(sampler.field(p.x,p.y))<1e-8,`Port ${p.id} lost its shore`);
    assert.ok(sampler.field(p.x-p.coastDirection.dx*4,p.y-p.coastDirection.dy*4)<0,`Port ${p.id} has no open water`);
    assert.ok(sampler.field(p.x+p.coastDirection.dx*6,p.y+p.coastDirection.dy*6)>0,`Port ${p.id} has no land behind it`);
  }
});

test('every real sea-route centreline remains clear of land',()=>{
  const ports=addCoasts(map.ports,map.routes), sampler=terrain.createSampler(ports,map.routes,map.seed);
  const byId=new Map(ports.map(p=>[p.id,p]));
  for(const route of map.routes) {
    const a=byId.get(route.a)!, b=byId.get(route.b)!;
    for(let step=0;step<=40;step++) {
      const t=step/40;
      assert.ok(sampler.field(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t)<=1e-8,`Blocked lane ${route.a}-${route.b}`);
    }
  }
});

test('terrain cache ignores live prices and ticks but changes with map geometry',()=>{
  const ports=addCoasts(map.ports,map.routes), state={ports,routes:map.routes,mapSeed:map.seed};
  const key=terrain.geometryKey(state,1000,700);
  assert.equal(terrain.geometryKey({...state,tick:100,prices:[12,42]},1000,700),key);
  assert.notEqual(terrain.geometryKey({...state,mapSeed:9},1000,700),key);
  assert.notEqual(terrain.geometryKey(state,900,700),key);
  assert.notEqual(terrain.geometryKey({...state,ports:ports.map(p=>({...p,x:p.x+1}))},1000,700),key);
});

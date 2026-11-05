import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startServer,Client,ADMIN,cleanup} from './helpers.ts';
import {Engine} from '../src/engine.ts';
import {validateSeasonMap} from '../src/random-season.ts';

test('navigation snapshot survives restart and authoritative distances drive voyages',async()=>{
  const s=await startServer(),c=new Client(s);let stopped=false;
  try{
    const st=await c.seen(m=>m.type==='static');
    assert.ok(st.navigation.terrain.waterBase64);
    await c.auth('register','NavigationTest');
    const state=await c.state(m=>m.me),ship=state.me.ships[0];
    const dest=(ship.port+1)%state.world.ports.length;
    assert.equal((await c.cmd({type:'sail',ship:ship.id,dest})).ok,true);
    const after=await c.fresh(m=>m.me?.ships[0].dest===dest);
    assert.equal(after.me.ships[0].arriveTick-after.me.ships[0].departTick,Math.max(1,Math.ceil(st.dist[ship.port][dest]/state.world.rules.speed)));
    c.close();await s.stop();stopped=true;
    const t=await startServer({},s.db),d=new Client(t);
    try{
      assert.deepEqual((await d.seen(m=>m.type==='static')).navigation,st.navigation);
      await d.auth('login','NavigationTest');
      const replay=await d.state(m=>m.me);
      assert.deepEqual(replay.me.ships,after.me.ships);
    }finally{d.close();await t.stop();}
  }finally{c.close();if(!stopped)await s.stop();cleanup(s);}
});

test('new seasons randomize all port positions, archive snapshots and keep accounts usable',async()=>{
  const s=await startServer({MAP_SEED:'season-sequence-test'}),c=new Client(s);
  try{
    await c.auth('register','SeasonOwner');
    const before=await c.seen(m=>m.type==='static');
    const oldState=await c.state(m=>m.me);
    const next=c.next(m=>m.type==='static'&&m.navigation.id!==before.navigation.id);
    const result=await fetch(s.url+'/api/admin/new-season',{method:'POST',headers:{'x-admin-token':ADMIN}});
    assert.equal(result.status,200);
    const newer=await next;
    assert.notEqual(newer.navigation.generation.seed,before.navigation.generation.seed);
    const newState=c.next(m=>m.type==='state'&&m.me&&m.world.navigationId===newer.navigation.id);
    await c.auth('login','SeasonOwner');
    const after=await newState;
    assert.notDeepEqual(after.world.ports.map((p:any)=>[p.x,p.y]),oldState.world.ports.map((p:any)=>[p.x,p.y]));
    assert.equal(after.me.cash,10000);
    const stored=new DatabaseSync(s.db);
    try{
      const current=stored.prepare('SELECT map_json FROM world_map WHERE id=1').get() as {map_json:string};
      const archived=stored.prepare('SELECT map_json FROM archived_maps WHERE season=1').get() as {map_json:string};
      assert.equal(validateSeasonMap(JSON.parse(current.map_json)),true);
      assert.equal(validateSeasonMap(JSON.parse(archived.map_json)),true);
      assert.equal(JSON.parse(archived.map_json).navigationId,before.navigation.id);
    }finally{stored.close();}
  }finally{c.close();await s.stop();cleanup(s);}
});

test('failed generation preserves the active map, accounts, sessions and archives',async()=>{
  const s=await startServer({MAP_SEED:'failure-preservation'}),c=new Client(s);
  let firstStopped=false;
  try{
    await c.auth('register','PreservedOwner');
    const initial=await c.seen(m=>m.type==='static');
    c.close();await s.stop();firstStopped=true;
    const t=await startServer({MAP_MIN_PORT_DISTANCE:'2000',MAP_MAX_ATTEMPTS:'2'},s.db),d=new Client(t);
    try{
      await d.auth('login','PreservedOwner');
      const current=await d.seen(m=>m.type==='static');
      assert.deepEqual(current.navigation,initial.navigation);
      const response=await fetch(t.url+'/api/admin/new-season',{method:'POST',headers:{'x-admin-token':ADMIN}});
      assert.equal(response.status,503);
      const stored=new DatabaseSync(t.db);
      try{
        const row=stored.prepare('SELECT map_json FROM world_map WHERE id=1').get() as {map_json:string};
        assert.equal(JSON.parse(row.map_json).navigationId,initial.navigation.id);
        assert.equal(stored.prepare('SELECT COUNT(*) AS n FROM archived_maps').get()!.n,0);
        assert.equal(stored.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n,1);
        assert.ok(Number(stored.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n)>0);
      }finally{stored.close();}
      assert.equal((await d.cmd({type:'placeOrder',port:0,good:'grain',qty:1,price:20})).ok,true);
    }finally{d.close();await t.stop();}
  }finally{c.close();if(!firstStopped)await s.stop();cleanup(s);}
});

test('legacy event logs retain their map until a new season, and maps are archived',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'manifest-legacy-navigation-')),path=join(dir,'game.db');
  const db=new DatabaseSync(path);
  db.exec('CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL)');
  db.prepare('INSERT INTO events(at,kind,payload) VALUES(?,?,?)').run(new Date().toISOString(),'register',JSON.stringify({type:'register',name:'LegacyCompany',startPort:0}));db.close();
  const s=await startServer({},path),c=new Client(s);
  try{
    const before=await c.seen(m=>m.type==='static');assert.equal(before.navigation.terrain,null);
    const map=JSON.parse(readFileSync(new URL('../../config/map.json',import.meta.url),'utf8'));
    const rules=JSON.parse(readFileSync(new URL('../../config/rules.json',import.meta.url),'utf8'));
    assert.deepEqual(before.dist,new Engine(rules,map,60).dist);
    const next=c.next(m=>m.type==='static'&&m.navigation.terrain);
    const res=await fetch(s.url+'/api/admin/new-season',{method:'POST',headers:{'x-admin-token':ADMIN}});
    assert.equal(res.status,200);assert.ok((await next).navigation.terrain);
    const stored=new DatabaseSync(path);
    try{const old=stored.prepare('SELECT map_json FROM archived_maps WHERE season=1').get() as {map_json:string};assert.equal(JSON.parse(old.map_json).terrain,undefined);}finally{stored.close();}
  }finally{c.close();await s.stop();cleanup(s);}
});

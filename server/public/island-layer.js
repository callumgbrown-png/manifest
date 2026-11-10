// Static world-space terrain. Shared by the browser and numerical terrain tests.
// Positive distance is land; negative distance is water.
(function (root) {
  'use strict';
  const clamp = t => Math.max(0, Math.min(1, t));
  const smooth = t => { t=clamp(t); return t*t*(3-2*t); };
  function hash(x,y,seed) {
    let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(seed,1442695041);
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967295;
  }
  function noise(x,y,seed) {
    const ix=Math.floor(x), iy=Math.floor(y), u=smooth(x-ix), v=smooth(y-iy);
    const a=hash(ix,iy,seed), b=hash(ix+1,iy,seed);
    const c=hash(ix,iy+1,seed), d=hash(ix+1,iy+1,seed);
    return ((a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v)*2-1;
  }

  function createSampler(ports,routes,seed=7) {
    const byId=new Map(ports.map(p=>[p.id,p]));
    const islands=ports.map(p=>{
      const {dx,dy}=p.coastDirection??{dx:1,dy:0}, length=Math.hypot(dx,dy);
      if (!Number.isFinite(length)||length<1e-6) throw new Error('Invalid coast at port '+p.id);
      let nearest=Infinity;
      for(const q of ports) if(q.id!==p.id) nearest=Math.min(nearest,Math.hypot(p.x-q.x,p.y-q.y));
      const r=Math.max(28,Math.min(85,nearest*.65));
      return {p,r,cx:p.x+dx/length*r,cy:p.y+dy/length*r};
    });
    const lanes=routes.flatMap(route=>{
      const a=byId.get(route.a), b=byId.get(route.b);
      if(!a||!b) return [];
      const dx=b.x-a.x, dy=b.y-a.y, length=Math.hypot(dx,dy);
      if(!length) return [];
      return [{a,dx,dy,length,length2:length*length,
        left:Math.min(a.x,b.x)-14,right:Math.max(a.x,b.x)+14,
        top:Math.min(a.y,b.y)-14,bottom:Math.max(a.y,b.y)+14}];
    });
    function field(x,y) {
      // Noise is shared across islands, evaluated only twice per raster pixel.
      const rough=noise(x/45,y/45,seed)*.16+noise(x/18,y/18,seed+1)*.05;
      let land=-1e9, nearest=Infinity, local=-1e9;
      for(const island of islands) {
        const {p,r,cx,cy}=island, distance=Math.hypot(x-p.x,y-p.y);
        const own=r-Math.hypot(x-cx,y-cy)+rough*r*smooth(distance/18);
        land=Math.max(land,own);
        if(distance<nearest) { nearest=distance; local=own; }
      }
      // Keep each port on its own shore even if other islands overlap it.
      if(nearest<18) land=local+(land-local)*smooth(nearest/18);
      for(const lane of lanes) {
        if(x<lane.left||x>lane.right||y<lane.top||y>lane.bottom) continue;
        const t=clamp(((x-lane.a.x)*lane.dx+(y-lane.a.y)*lane.dy)/lane.length2);
        const distance=Math.hypot(x-lane.a.x-t*lane.dx,y-lane.a.y-t*lane.dy);
        const fromEnd=Math.min(t,1-t)*lane.length;
        land=Math.min(land,distance-9*smooth(fromEnd/16)*smooth(nearest/12));
      }
      return land;
    }
    return {field};
  }

  function geometryKey(world,width,height) {
    return JSON.stringify([width,height,world.mapSeed??7,
      world.ports.map(p=>[p.id,p.x,p.y,p.coastDirection?.dx,p.coastDirection?.dy]),
      world.routes.map(r=>[r.a,r.b])]);
  }

  function createLayer(ports,routes,width,height,seed=7,cellSize=2) {
    const started=performance.now(), {field}=createSampler(ports,routes,seed);
    const canvas=document.createElement('canvas');
    canvas.width=Math.ceil(width/cellSize); canvas.height=Math.ceil(height/cellSize);
    const g=canvas.getContext('2d'), image=g.createImageData(canvas.width,canvas.height);
    for(let py=0;py<canvas.height;py++) for(let px=0;px<canvas.width;px++) {
      const x=(px+.5)*width/canvas.width, y=(py+.5)*height/canvas.height;
      const value=field(x,y);
      let colour;
      if(value>11) colour=[51,77,59,255];
      else if(value>3) colour=[73,101,70,255];
      else if(value>=0) colour=[179,165,119,255];
      else if(value>-5) colour=[58,126,141,140];
      else continue;
      image.data.set(colour,(py*canvas.width+px)*4);
    }
    g.putImageData(image,0,0);
    return {canvas,buildMs:performance.now()-started};
  }
  root.ManifestIslands={createSampler,geometryKey,createLayer};
})(globalThis);

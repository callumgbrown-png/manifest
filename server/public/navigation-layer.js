(function(root){
  'use strict';
  function prepare(points){
    const clean=points.filter((p,i)=>!i||p.x!==points[i-1].x||p.y!==points[i-1].y);
    const lengths=clean.slice(1).map((p,i)=>Math.hypot(p.x-clean[i].x,p.y-clean[i].y));
    return {points:clean,lengths,total:lengths.reduce((a,b)=>a+b,0)};
  }
  function position(geometry,f){
    const {points,lengths,total}=geometry;
    if(!points.length)throw new Error('Missing route geometry');
    let left=Math.max(0,Math.min(1,f))*total;
    for(let i=0;i<lengths.length;i++){
      if(left<=lengths[i]||i===lengths.length-1){
        const a=points[i],b=points[i+1],t=lengths[i]?Math.min(1,left/lengths[i]):0;
        return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x),path:points,seg:i};
      }
      left-=lengths[i];
    }
    return {...points[0],angle:0,path:points,seg:0};
  }
  function routeIndex(routes,ports){
    const byId=new Map(ports.map(p=>[p.id,p])),index=new Map();
    for(const r of routes){
      const points=r.waypoints??[byId.get(r.a),byId.get(r.b)];
      index.set(`${r.a}:${r.b}`,prepare(points));
      index.set(`${r.b}:${r.a}`,prepare([...points].reverse()));
    }
    return index;
  }
  function voyage(portIds,index){
    const points=[];
    for(let i=1;i<portIds.length;i++){
      const edge=index.get(`${portIds[i-1]}:${portIds[i]}`);
      if(!edge)throw new Error('Missing sea lane');
      points.push(...(points.length?edge.points.slice(1):edge.points));
    }
    return prepare(points);
  }
  function stroke(ctx,points,project){
    if(points.length<2)return;
    ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...project(p)));ctx.stroke();
  }
  function terrainBuffer(terrain){
    const bytes=atob(terrain.waterBase64),water=Uint8Array.from(bytes,c=>c.charCodeAt(0));
    if(water.length!==terrain.cols*terrain.rows)throw new Error('Invalid terrain');
    const canvas=document.createElement('canvas');canvas.width=terrain.cols;canvas.height=terrain.rows;
    const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height);
    const wet=(x,y)=>x<0||y<0||x>=terrain.cols||y>=terrain.rows||water[y*terrain.cols+x]===1;
    for(let y=0;y<terrain.rows;y++)for(let x=0;x<terrain.cols;x++){
      const sea=wet(x,y),edge=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>wet(x+dx,y+dy)!==sea);
      if(sea&&!edge)continue;
      image.data.set(sea?[58,126,141,46]:edge?[179,165,119,255]:[62,90,65,255],(y*terrain.cols+x)*4);
    }
    ctx.putImageData(image,0,0);return canvas;
  }
  root.ManifestNavigation={prepare,position,routeIndex,voyage,stroke,terrainBuffer};
})(globalThis);

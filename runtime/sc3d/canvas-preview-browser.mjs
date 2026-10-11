// GPU-free, source-derived SC3D preview. Diagnostic only; not the Three.js production renderer.
const DEG=Math.PI/180;
const normalized=v=>{const d=Math.hypot(...v)||1;return v.map(x=>x/d)};
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((x,v,i)=>x+v*b[i],0);
function identity(){return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
function multiply(a,b){const c=new Array(16).fill(0);for(let r=0;r<4;r++)for(let col=0;col<4;col++)for(let k=0;k<4;k++)c[r*4+col]+=a[r*4+k]*b[k*4+col];return c}
function translate(v){const m=identity();m[3]=v[0];m[7]=v[1];m[11]=v[2];return m}
function rotateScale(transform={}){
 const [rx,ry,rz]=(transform.rotate_deg??[0,0,0]).map(x=>x*DEG),[sx,sy,sz]=transform.scale??[1,1,1];
 const [cx,cy,cz]=[Math.cos(rx),Math.cos(ry),Math.cos(rz)];
 const [ax,ay,az]=[Math.sin(rx),Math.sin(ry),Math.sin(rz)];
 // Euler XYZ, matching the SC3D Three.js adapter.
 const mx=[1,0,0,0,0,cx,-ax,0,0,ax,cx,0,0,0,0,1];
 const my=[cy,0,ay,0,0,1,0,0,-ay,0,cy,0,0,0,0,1];
 const mz=[cz,-az,0,0,az,cz,0,0,0,0,1,0,0,0,0,1];
 const scale=[sx,0,0,0,0,sy,0,0,0,0,sz,0,0,0,0,1];
 return multiply(multiply(multiply(mx,my),mz),scale)
}
function matrixFor(transform){return multiply(translate(transform?.translate??[0,0,0]),rotateScale(transform))}
function point(m,p){return [m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11]]}
function vertices(geometry){
 if(geometry.kind==='cuboid'){
  const [x,y,z]=geometry.size.map(x=>x/2);
  return [[-x,-y,-z],[x,-y,-z],[x,-y,z],[-x,-y,z],[-x,y,-z],[x,y,-z],[x,y,z],[-x,y,z]]
 }
 if(geometry.kind==='tapered_box'){
  const [bx,bz]=geometry.bottom.map(v=>v/2),[tx,tz]=geometry.top.map(v=>v/2),y=geometry.height/2;
  return [[-bx,-y,-bz],[bx,-y,-bz],[bx,-y,bz],[-bx,-y,bz],[-tx,y,-tz],[tx,y,-tz],[tx,y,tz],[-tx,y,tz]]
 }
 throw new Error('Unsupported software-preview geometry '+geometry.kind+'; no silent omission')
}
const FACE_INDICES=[[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]];
function hexColor(value){
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Unexpected material color '+String(value));
 return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16))
}
export function flattenSc3d(ir){
 if(!ir?.parts||!ir?.materials||!ir.asset?.root)throw new Error('SC3D IR missing root, parts or materials');
 const cache=new Map(),ongoing=new Set();
 function getWorld(id){
  if(cache.has(id))return cache.get(id);
  if(ongoing.has(id))throw new Error('SC3D parent cycle at '+id);
  const part=ir.parts[id];if(!part)throw new Error('Missing part '+id);
  ongoing.add(id);
  const local=matrixFor(part.transform);
  const world=part.parent==null?local:multiply(getWorld(part.parent),local);
  cache.set(id,world);ongoing.delete(id);return world
 }
 const meshes=[];
 for(const [id,p] of Object.entries(ir.parts)){
  if(p.pivot||p.attachment)throw new Error('Software preview does not yet support pivot/anchor part '+id);
  if(!p.geometry||p.visible===false)continue;
  if(!p.material||!ir.materials[p.material])throw new Error('Missing material on '+id);
  const g=p.geometry.ref?ir.geometry_library?.[p.geometry.ref]:p.geometry;
  if(!g)throw new Error('Unresolved geometry for '+id);
  let matrix=getWorld(id);
  if(g.transform)matrix=multiply(matrix,matrixFor(g.transform));
  if((ir.materials[p.material].opacity??1)!==1)throw new Error('Software preview cannot reliably depth-sort transparent part '+id);
  const transformed=vertices(g).map(v=>point(matrix,v));
  meshes.push({id,points:transformed,color:hexColor(ir.materials[p.material].base_color)})
 }
 return meshes
}
export function createCanvasViewer(canvas,ir,{status=null}={}){
 const meshes=flattenSc3d(ir);
 const ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx)throw new Error('2D canvas context unavailable');
 const coords=meshes.flatMap(m=>m.points);
 const min=[0,1,2].map(k=>Math.min(...coords.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...coords.map(p=>p[k])));
 const target=min.map((v,i)=>(v+max[i])/2),radius=Math.hypot(...max.map((v,i)=>v-min[i]))/2;
 let azimuth=-35,elevation=24,zoom=1,dragging=false,last=[0,0];
 const sunlight=normalized([-0.5,1.3,-0.8]);
 function draw(){
  const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);
  const dpr=Math.min(window.devicePixelRatio??1,1.5,Math.sqrt(1200000/(width*height)));
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
   canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)
  }
  const widthPx=canvas.width,heightPx=canvas.height;
  const a=azimuth*DEG,e=elevation*DEG;
  const direction=normalized([-Math.sin(a)*Math.cos(e),Math.sin(e),-Math.cos(a)*Math.cos(e)]);
  const forward=direction.map(x=>-x),right=normalized(cross(forward,[0,1,0])),up=normalized(cross(right,forward));
  const scale=Math.min(widthPx,heightPx)*zoom/Math.max(6.5,2.2*radius);
  // Real z-buffer. Average-depth polygon sorting hides furniture behind a large floor.
  const depthBuffer=new Float32Array(widthPx*heightPx);depthBuffer.fill(Infinity);
  const image=ctx.createImageData(widthPx,heightPx),pixels=image.data;
  const start=[248,245,238],end=[217,227,229];
  for(let y=0;y<heightPx;y++){
   const t=y/Math.max(1,heightPx-1),rr=Math.round(start[0]+(end[0]-start[0])*t),gg=Math.round(start[1]+(end[1]-start[1])*t),bb=Math.round(start[2]+(end[2]-start[2])*t);
   for(let x=0;x<widthPx;x++){const i=(y*widthPx+x)*4;pixels[i]=rr;pixels[i+1]=gg;pixels[i+2]=bb;pixels[i+3]=255}
  }
  let visibleFaces=0;
  function paintTriangle(a,b,c,rgb){
   const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));
   const minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));
   const maxX=Math.min(widthPx-1,Math.ceil(Math.max(a[0],b[0],c[0])));
   const maxY=Math.min(heightPx-1,Math.ceil(Math.max(a[1],b[1],c[1])));
   const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
   if(Math.abs(area)<1e-10)return;
   const inv=1/area;
   for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const sx=x+.5,sy=y+.5;
    const w1=((sx-a[0])*(c[1]-a[1])-(sy-a[1])*(c[0]-a[0]))*inv;
    const w2=((b[0]-a[0])*(sy-a[1])-(b[1]-a[1])*(sx-a[0]))*inv;
    const w0=1-w1-w2;
    if(w0<-1e-8||w1<-1e-8||w2<-1e-8)continue;
    const depth=w0*a[2]+w1*b[2]+w2*c[2],index=y*widthPx+x;
    if(depth>=depthBuffer[index])continue;
    const px=index*4;pixels[px]=rgb[0];pixels[px+1]=rgb[1];pixels[px+2]=rgb[2];
    depthBuffer[index]=depth
   }
  }
  for(const mesh of meshes){
   for(const inds of FACE_INDICES){
    const pts=inds.map(i=>mesh.points[i]);
    const normal=normalized(cross(sub(pts[1],pts[0]),sub(pts[2],pts[1])));
    if(dot(normal,direction)<=0.00001)continue;
    visibleFaces++;
    const k=Math.max(0.5,Math.min(1.16,0.7+0.46*dot(normal,sunlight)));
    const rgb=mesh.color.map(c=>Math.max(0,Math.min(255,Math.round(c*k))));
    const projected=pts.map(p=>{const diff=sub(p,target);return [widthPx/2+dot(diff,right)*scale,heightPx/2-dot(diff,up)*scale,dot(diff,forward)]});
    paintTriangle(projected[0],projected[1],projected[2],rgb);
    paintTriangle(projected[0],projected[2],projected[3],rgb)
   }
  }
  ctx.putImageData(image,0,0);
  if(status)status.textContent='Software 3D · '+meshes.length+' meshes · '+visibleFaces+' visible faces · azimuth '+Math.round(azimuth)+'° · elevation '+Math.round(elevation)+'°'
 }
 function preset(a,e){azimuth=a;elevation=e;zoom=1;draw()}
 const onMove=evt=>{if(!dragging)return;const next=[evt.clientX,evt.clientY];azimuth+=(next[0]-last[0])*.38;elevation=Math.min(82,Math.max(5,elevation+(next[1]-last[1])*.26));last=next;draw()};
 canvas.addEventListener('pointerdown',evt=>{dragging=true;last=[evt.clientX,evt.clientY];canvas.setPointerCapture(evt.pointerId)});
 canvas.addEventListener('pointermove',onMove);
 canvas.addEventListener('pointerup',evt=>{dragging=false;if(canvas.hasPointerCapture(evt.pointerId))canvas.releasePointerCapture(evt.pointerId)});
 canvas.addEventListener('pointercancel',()=>dragging=false);
 canvas.addEventListener('wheel',evt=>{evt.preventDefault();zoom=Math.max(.55,Math.min(2.5,zoom*Math.exp(-evt.deltaY*.001)));draw()},{passive:false});
 const observer=new ResizeObserver(draw);observer.observe(canvas);
 draw();
 return {draw,preset,meshCount:meshes.length,dispose(){observer.disconnect()}}
}

/**
 * Scenarium portable in-chat preview core.
 * Reads the scene's source-bound packet; does not rewrite SC3D or implement
 * a second semantic loader. Canonical Ajv/lowering is checked by the packet
 * producer before the packet reaches this alternate renderer.
 *
 * Implements the narrow accepted cuboid/tapered-box surface projection plus
 * a perspective-correct CPU depth buffer. Not canonical Three.js/WebGL.
 * Host owns embedding, source provenance and any review decision.
 */

const DEG = Math.PI / 180;
const ZERO = Object.freeze([0, 0, 0]);
const ONE = Object.freeze([1, 1, 1]);

function invariant(condition, message) {
  if (!condition) throw new Error("Chat scene preview: " + message);
}
function vector(value, fallback, label, {nonzero=false} = {}) {
  const a = value == null || value === "-" ? [...fallback] :
    Array.isArray(value) ? value.map(Number) : String(value).split(",").map(Number);
  invariant(a.length === fallback.length && a.every(Number.isFinite),
    label + " must be a finite " + fallback.length + "-vector");
  if (nonzero) invariant(a.every(x => x !== 0), label + " contains a zero scale");
  return a;
}
function threeTransform(source, label) {
  return {
    translate: vector(source?.translate, ZERO, label + ".translate"),
    rotate_deg: vector(source?.rotate_deg, ZERO, label + ".rotate_deg"),
    scale: vector(source?.scale, ONE, label + ".scale", {nonzero: true}),
  };
}
function vecAdd(a,b) { return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function sub(a,b) { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function dot(a,b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a,b) {
  return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
}
function unit(a) {
  const m = Math.hypot(...a);
  invariant(m > 1e-12 && Number.isFinite(m), "degenerate vector");
  return a.map(x=>x/m);
}
function rotateXYZ(v, r) {
  // THREE.Euler(..., "XYZ") yields Rx * Ry * Rz: apply Z, then Y, then X.
  let [x,y,z] = v;
  const [rx,ry,rz] = r.map(degrees => degrees*DEG);
  if (rz !== 0) {
    const c=Math.cos(rz),s=Math.sin(rz);
    [x,y]=[x*c-y*s,x*s+y*c];
  }
  if (ry !== 0) {
    const c=Math.cos(ry),s=Math.sin(ry);
    [x,z]=[x*c+z*s,-x*s+z*c];
  }
  if (rx !== 0) {
    const c=Math.cos(rx),s=Math.sin(rx);
    [y,z]=[y*c-z*s,y*s+z*c];
  }
  return [x,y,z];
}
function applyTransform(point, t) {
  return vecAdd(rotateXYZ(point.map((n,i)=>n*t.scale[i]),t.rotate_deg),t.translate);
}
function transformPoint(point, chain) {
  let result=point;
  for (const t of chain) result=applyTransform(result,t);
  return result;
}
function parseMaterial(hex, label) {
  invariant(typeof hex==="string" && /^[a-f0-9]{6}$/i.test(hex),
    label + " invalid RGB material");
  return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
}
function parseRow(line, groups, lineNo) {
  const cells=line.split("|");
  invariant(cells.length===8 || cells.length===9,"primitive record " + lineNo + " has invalid arity");
  const [groupText,id,parent,type,dim,color,translate,rotate,scale]=cells;
  invariant(/^(0|[1-9][0-9]*)$/.test(groupText),"primitive " + lineNo + " has invalid group index");
  const group=Number(groupText);
  invariant(group < groups.length,"primitive " + lineNo + " group outside scene");
  invariant(typeof id==="string" && /^[a-zA-Z_][\w.-]*$/.test(id),
    "primitive " + lineNo + " invalid identity");
  invariant(type==="b" || type==="t","primitive " + id + " unsupported type");
  const dims=vector(dim,Array(type==="b"?3:5).fill(0),id+".dimensions");
  invariant(dims.every(x=>x>0),id+" nonpositive dimension");
  return {
    group,id,parent,kind:type,dimensions:dims,
    rgb:parseMaterial(color,id),
    transform:threeTransform({translate,rotate_deg:rotate,scale},id),
  };
}
function normalize(packetOrPresentation) {
  const p=packetOrPresentation?.presentation ?? packetOrPresentation;
  invariant(p && Array.isArray(p.groups) && typeof p.parts==="string","missing geometry packet");
  if (packetOrPresentation?.format==="scenarium-chat-review-packet-v1") {
    invariant(packetOrPresentation.state==="prepared_not_presented","unexpected source packet state");
    invariant(packetOrPresentation.renderer_claim==="canonical_ir_alternate_renderer",
      "unexpected renderer provenance");
  }
  const groups=p.groups.map((source,index)=>{
    invariant(source.index===index && typeof source.id==="string" && source.id.length>0,
      "group index/identity mismatch at "+index);
    return {...source,transform:threeTransform(source,"group "+source.id)};
  });
  invariant(new Set(groups.map(x=>x.id)).size===groups.length,
    "duplicate component identity");
  const lines=p.parts.split("\n");
  invariant(lines.length>0,"no primitive records");
  const parts=lines.map((line,index)=>parseRow(line,groups,index));
  if(packetOrPresentation?.canonical_semantics) {
    invariant(parts.length===packetOrPresentation.canonical_semantics.geometry_part_count,
      "packet and part count disagree");
    invariant(groups.length===packetOrPresentation.canonical_semantics.component_count,
      "packet and component count disagree");
  }
  const index=new Map();
  for (const part of parts) {
    const key=part.group+"/"+part.id;
    invariant(!index.has(key),"duplicate identity "+key);
    index.set(key,part);
  }
  const chainMemo=new Map(),visiting=new Set();
  function chain(part) {
    const key=part.group+"/"+part.id;
    if (chainMemo.has(key)) return chainMemo.get(key);
    invariant(!visiting.has(key),"hierarchy cycle "+key);
    visiting.add(key);
    let transforms=[part.transform];
    if (part.parent!=="-") {
      const parent=index.get(part.group+"/"+part.parent);
      invariant(parent,"unknown parent of "+key+": "+part.parent);
      transforms=[...transforms,...chain(parent).slice(0,-1)];
    }
    transforms.push(groups[part.group].transform);
    chainMemo.set(key,transforms);
    visiting.delete(key);
    return transforms;
  }
  for (const part of parts) part.chain=chain(part);
  return {groups,parts};
}
const FACE_INDEX=[
  [0,3,2,1],[4,5,6,7],[0,1,5,4],
  [1,2,6,5],[2,3,7,6],[3,0,4,7],
];
export function realizeChatScene(packetOrPresentation) {
  const {groups,parts}=normalize(packetOrPresentation);
  const objects=parts.map((part,sourceIndex)=>{
    const [bx,bz,tx,tz,h]=part.kind==="b" ?
      [part.dimensions[0],part.dimensions[2],part.dimensions[0],part.dimensions[2],part.dimensions[1]] :
      part.dimensions;
    const local=[
      [-bx/2,-h/2,-bz/2],[bx/2,-h/2,-bz/2],[bx/2,-h/2,bz/2],[-bx/2,-h/2,bz/2],
      [-tx/2,h/2,-tz/2],[tx/2,h/2,-tz/2],[tx/2,h/2,tz/2],[-tx/2,h/2,tz/2]
    ];
    const corners=local.map(v=>transformPoint(v,part.chain));
    const center=transformPoint(ZERO,part.chain);
    const faces=FACE_INDEX.map(indices=>{
      const vertices=indices.map(i=>corners[i]);
      const midpoint=vertices[0].map((_,i)=>vertices.reduce((sum,v)=>sum+v[i],0)/4);
      let normal=unit(cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])));
      if(dot(normal,sub(midpoint,center))<0) normal=normal.map(x=>-x);
      return {vertices,normal,color:part.rgb};
    });
    return {id:part.id,group:part.group,groupId:groups[part.group].id,
      sourceIndex,center,faces};
  });
  const vertices=objects.flatMap(x=>x.faces.flatMap(f=>f.vertices));
  const bounds=vertices.reduce((o,v)=>({
    min:o.min.map((n,i)=>Math.min(n,v[i])),max:o.max.map((n,i)=>Math.max(n,v[i]))
  }),{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
  return {groups,objects,partCount:parts.length,bounds,
    rendererKind:"source_bound_alternate_cpu_depth",
    sourceClass:packetOrPresentation?.format==="scenarium-chat-review-packet-v1" ?
      "canonical_ir_alternate_renderer" : "source_bound_alternate_renderer",
    omittedMaterialEffects:[...(
      packetOrPresentation?.canonical_semantics?.material_effects_not_rendered??[]
    )]};
}
function nearClip(poly,near){
  const clipped=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const ina=a[2]>=near,inb=b[2]>=near;
    if(ina)clipped.push(a);
    if(ina!==inb){
      const t=(near-a[2])/(b[2]-a[2]);
      clipped.push(a.map((v,j)=>v+t*(b[j]-v)));
    }
  }
  return clipped;
}
function raster(a,b,c,color,width,height,image,depth,owner,priority){
  const [x0,y0,z0]=a,[x1,y1,z1]=b,[x2,y2,z2]=c;
  const minX=Math.max(0,Math.floor(Math.min(x0,x1,x2)));
  const maxX=Math.min(width-1,Math.ceil(Math.max(x0,x1,x2)));
  const minY=Math.max(0,Math.floor(Math.min(y0,y1,y2)));
  const maxY=Math.min(height-1,Math.ceil(Math.max(y0,y1,y2)));
  const edge=(ax,ay,bx,by,px,py)=>(px-ax)*(by-ay)-(py-ay)*(bx-ax);
  const area=edge(x0,y0,x1,y1,x2,y2);
  if(Math.abs(area)<0.01 || minX>maxX || minY>maxY)return;
  const inv=1/area,az=1/z0,bz=1/z1,cz=1/z2;
  // Incremental barycentric scanlines compute each triangle's edge
  // equations only once, avoiding 4 edge recalculations per pixel.
  const duDx=(y2-y1)*inv,duDy=-(x2-x1)*inv;
  const dvDx=(y0-y2)*inv,dvDy=-(x0-x2)*inv;
  let uRow=edge(x1,y1,x2,y2,minX+0.5,minY+0.5)*inv;
  let vRow=edge(x2,y2,x0,y0,minX+0.5,minY+0.5)*inv;
  for(let y=minY;y<=maxY;y++){
    let u=uRow,v=vRow;
    for(let x=minX;x<=maxX;x++,u+=duDx,v+=dvDx){
      const t=1-u-v;
      if(u<0||v<0||t<0)continue;
      const z=u*az+v*bz+t*cz,i=y*width+x;
      // Preserve deterministic depth ties independent of source traversal.
      const quantized=Math.round(z*1e7);
      if(quantized<depth[i] || (quantized===depth[i] && priority<=owner[i]))continue;
      depth[i]=quantized;owner[i]=priority;
      const k=i*4;image[k]=color[0];image[k+1]=color[1];image[k+2]=color[2];
    }
    uRow+=duDy;vRow+=dvDy;
  }
}
const DEFAULT_BG=[233,240,235];
export function renderChatSceneFrame(scene,{
  width=640,height=380,
  azimuth=0.6,elevation=0.56,distance,
  target,hiddenGroups=[],background=DEFAULT_BG
}={}){
  invariant(scene?.objects?.length>0,"empty realized scene");
  invariant(Number.isInteger(width)&&Number.isInteger(height)&&
    width>0&&height>0&&width*height<=1024*1024,
    "invalid canvas dimensions; max 1,048,576 pixels");
  const bounds=scene.bounds;
  const center=target??bounds.min.map((v,i)=>(v+bounds.max[i])/2);
  const radius=Math.hypot(...bounds.max.map((v,i)=>v-bounds.min[i]))/2;
  const dist=distance??Math.max(7,radius*2.6);
  invariant(Number.isFinite(dist)&&dist>0,"invalid camera distance");
  const eye=[
    center[0]+dist*Math.sin(azimuth)*Math.cos(elevation),
    center[1]+dist*Math.sin(elevation),
    center[2]-dist*Math.cos(azimuth)*Math.cos(elevation)
  ];
  const forward=unit(sub(center,eye));
  // An exactly vertical camera has no cross product with the world-up
  // axis. Switch the reference axis only near that singularity; ordinary
  // approved default camera frames remain byte-for-byte unchanged.
  const upReference=Math.abs(dot(forward,[0,1,0]))>0.999999
    ? [0,0,1] : [0,1,0];
  const right=unit(cross(forward,upReference)),up=cross(right,forward);
  const focal=Math.min(width,height)*1.5,near=0.2;
  const pixels=new Uint8ClampedArray(width*height*4),depth=new Int32Array(width*height),
    owner=new Int32Array(width*height).fill(-1);
  for(let i=0;i<pixels.length;i+=4){
    pixels[i]=background[0];pixels[i+1]=background[1];pixels[i+2]=background[2];pixels[i+3]=255;
  }
  const hidden=new Set(hiddenGroups),light=unit([-0.5,1,-0.6]);
  let visibleParts=0,visibleFaces=0;
  for (const part of scene.objects) {
    if(hidden.has(part.groupId)||hidden.has(part.group))continue;
    visibleParts++;
    for(let faceIndex=0;faceIndex<part.faces.length;faceIndex++){
      const face=part.faces[faceIndex];
      const mid=face.vertices[0].map((_,i)=>face.vertices.reduce((sum,v)=>sum+v[i],0)/4);
      if(dot(face.normal,sub(eye,mid))<=0) continue;
      const cameraVerts=face.vertices.map(v=>{
        const d=sub(v,eye);
        return [dot(d,right),dot(d,up),dot(d,forward)];
      });
      const poly=nearClip(cameraVerts,near);
      if(poly.length<3)continue;
      visibleFaces++;
      const shade=0.70+0.30*Math.max(0,dot(face.normal,light));
      const color=face.color.map(x=>Math.round(x*shade));
      const projected=poly.map(([x,y,z])=>[
        width/2+x*focal/z,height/2-y*focal/z,z
      ]);
      for(let j=1;j+1<projected.length;j++){
        raster(projected[0],projected[j],projected[j+1],
          color,width,height,pixels,depth,owner,
          part.sourceIndex*32+faceIndex*4+j);
      }
    }
  }
  return {width,height,pixels,depth,depthEncoding:"inverse_distance_1e7",
    visibleParts,visibleFaces,
    backend:"CPU Z-buffer (alternate scene presentation)"};
}
export function createChatSceneViewer({
  canvas,packet,onStatus=()=>{},onError=()=>{},maxWidth=700,
  interactionWidth=360
}){
  invariant(canvas?.getContext && canvas?.getBoundingClientRect,
    "host must provide a canvas");
  const ctx=canvas.getContext("2d",{alpha:false});
  invariant(ctx,"Canvas 2D is unavailable");
  const scene=realizeChatScene(packet);
  const size=scene.bounds.max.map((v,i)=>v-scene.bounds.min[i]);
  const target=scene.bounds.min.map((v,i)=>(v+scene.bounds.max[i])/2);
  const defaultDistance=Math.max(7,Math.hypot(...size)*1.3);
  const state={azimuth:0.6,elevation:0.56,distance:defaultDistance,
    hiddenGroups:new Set(),lastFrame:null};
  const minDistance=Math.max(1.5,defaultDistance*0.25);
  const maxDistance=defaultDistance*3;
  const pointers=new Map();
  let pinch=0,queued=false,disposed=false,interacting=false,settleTimer=null;
  invariant(Number.isFinite(interactionWidth) && interactionWidth>0,
    "invalid interactive raster resolution");
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const raf=typeof requestAnimationFrame==="function" ? requestAnimationFrame :
    callback=>callback();
  function draw(){
    if(disposed)return;
    const rect=canvas.getBoundingClientRect();
    const cssW=Math.max(1,rect.width),cssH=Math.max(1,rect.height);
    const widthLimit=interacting ? Math.min(maxWidth,interactionWidth) : maxWidth;
    const width=Math.max(1,Math.min(Math.floor(widthLimit),Math.round(cssW)));
    const height=Math.max(1,Math.min(Math.floor(1024*1024/width),
      Math.round(cssH*width/cssW)));
    const frame=renderChatSceneFrame(scene,{
      width,height,azimuth:state.azimuth,elevation:state.elevation,
      distance:state.distance,target,hiddenGroups:[...state.hiddenGroups]
    });
    // Changing canvas dimensions resets the backing store and drawing state.
    // Do this only on an actual raster size change, not on every orbit frame.
    if(canvas.width!==width)canvas.width=width;
    if(canvas.height!==height)canvas.height=height;
    const image=ctx.createImageData(width,height);
    image.data.set(frame.pixels);
    ctx.putImageData(image,0,0);
    state.lastFrame=frame;
    onStatus({parts:frame.visibleParts,total:scene.partCount,
      backend:frame.backend,frameReady:true,
      rasterResolution:[width,height],resolutionMode:interacting?"interaction":"full"});
  }
  function requestDraw(){
    if(disposed||queued)return;
    queued=true;
    raf(()=>{
      queued=false;
      try{draw();}catch(error){onError(error);}
    });
  }
  function preset(view){
    if(view==="overhead"){state.azimuth=0.22;state.elevation=1.42;state.distance=defaultDistance;}
    else if(view==="line"){state.azimuth=0.12;state.elevation=0.32;state.distance=defaultDistance*0.82;}
    else {state.azimuth=0.6;state.elevation=0.56;state.distance=defaultDistance;}
    requestDraw();
  }
  function toggleGroup(id,visible){
    invariant(scene.groups.some(g=>g.id===id),"unknown group "+id);
    if(visible)state.hiddenGroups.delete(id);else state.hiddenGroups.add(id);
    requestDraw();
  }
  // DIL/chat host controls can bind a single visibility record to the
  // renderer without coupling the engine to Factory-specific group names.
  function setVisibilityMap(visibility){
    invariant(visibility && typeof visibility==="object" &&
      !Array.isArray(visibility),"visibility must be a group-id record");
    const groupIds=new Set(scene.groups.map(g=>g.id));
    for(const [id,visible] of Object.entries(visibility)){
      invariant(groupIds.has(id),"unknown group "+id);
      invariant(typeof visible==="boolean","visibility must be boolean: "+id);
      if(visible)state.hiddenGroups.delete(id);
      else state.hiddenGroups.add(id);
    }
    requestDraw();
  }
  function zoomBy(factor){
    invariant(Number.isFinite(factor) && factor>0,"invalid zoom factor");
    state.distance=clamp(state.distance/factor,minDistance,maxDistance);
    requestDraw();
  }
  function down(event){
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId,[event.clientX,event.clientY]);pinch=0;
    interacting=true;
    if(settleTimer!==null && typeof clearTimeout==="function") {
      clearTimeout(settleTimer);settleTimer=null;
    }
  }
  function move(event){
    if(!pointers.has(event.pointerId))return;
    const previous=pointers.get(event.pointerId);
    pointers.set(event.pointerId,[event.clientX,event.clientY]);
    if(pointers.size===1){
      state.azimuth+=(event.clientX-previous[0])*0.008;
      state.elevation=clamp(state.elevation+(event.clientY-previous[1])*0.006,0.08,1.49);
    }else if(pointers.size===2){
      const [a,b]=[...pointers.values()],next=Math.hypot(a[0]-b[0],a[1]-b[1]);
      if(pinch>0)state.distance=clamp(state.distance*pinch/Math.max(1,next),
        minDistance,maxDistance);
      pinch=next;
    }
    requestDraw();
  }
  function up(event){
    pointers.delete(event.pointerId);pinch=0;
    if(pointers.size===0){interacting=false;requestDraw();}
  }
  function wheel(event){
    event.preventDefault?.();
    state.distance=clamp(state.distance*Math.exp(event.deltaY*0.001),
      minDistance,maxDistance);
    // Interactive quality during a wheel burst; restore full quality once
    // scrolling settles. Timerless test hosts simply draw in full quality.
    if(typeof setTimeout==="function") {
      interacting=true;
      if(settleTimer!==null && typeof clearTimeout==="function")clearTimeout(settleTimer);
      settleTimer=setTimeout(()=>{settleTimer=null;
        if(pointers.size===0){interacting=false;requestDraw();}
      },130);
    }
    requestDraw();
  }
  const handlers=[
    ["pointerdown",down],["pointermove",move],["pointerup",up],
    ["pointercancel",up],["wheel",wheel]
  ];
  for(const [event,handler] of handlers){
    canvas.addEventListener(event,handler,event==="wheel"?{passive:false}:undefined);
  }
  const observer=typeof ResizeObserver!=="undefined" ?
    new ResizeObserver(requestDraw) : null;
  observer?.observe(canvas);
  requestDraw();
  return {
    scene,requestDraw,
    reset:()=>preset("reset"),preset,
    toggleGroup,setVisibilityMap,zoomBy,
    getState:()=>({
      azimuth:state.azimuth,elevation:state.elevation,distance:state.distance,
      hiddenGroups:[...state.hiddenGroups],
      renderedParts:state.lastFrame?.visibleParts??0,
      rasterResolution:state.lastFrame ?
        [state.lastFrame.width,state.lastFrame.height] : null,
      interacting
    }),
    dispose(){
      disposed=true;
      if(settleTimer!==null && typeof clearTimeout==="function")clearTimeout(settleTimer);
      settleTimer=null;
      observer?.disconnect();
      for(const [event,handler] of handlers)canvas.removeEventListener(event,handler);
    },
  };
}

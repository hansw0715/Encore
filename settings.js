(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.VenueSettings=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const defaults={enabled:true,rev:.25,clarity:.5,crowd:.5,vol:.3,head:.65,latencyMode:'sync',seat:{x:10,y:1.65,z:14,floor:true,name:'동상 앞 플로어'},forward:{x:-.144,y:.121,z:-.982}};
 const finite=(v,d,min,max)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):d;
 function clean(input={},base=defaults){
  const out=JSON.parse(JSON.stringify(base));
  for(const k of ['rev','crowd','vol','head','clarity'])if(k in input)out[k]=finite(input[k],base[k],0,1);
  if(typeof input.enabled==='boolean')out.enabled=input.enabled;
  if(['sync','distance'].includes(input.latencyMode))out.latencyMode=input.latencyMode;
  if(input.seat){const v=input.seat;out.seat={x:finite(v.x,base.seat.x,-110,110),y:finite(v.y,base.seat.y,1,40),z:finite(v.z,base.seat.z,-48,150),floor:typeof v.floor==='boolean'?v.floor:base.seat.floor,name:typeof v.name==='string'?v.name.slice(0,40):base.seat.name}}
  if(input.forward){const v=input.forward;const x=finite(v.x,base.forward.x,-1,1),y=finite(v.y,base.forward.y,-1,1),z=finite(v.z,base.forward.z,-1,1),len=Math.hypot(x,y,z);if(len>.1)out.forward={x:x/len,y:y/len,z:z/len}}
  return out;
 }
 return {defaults,clean};
});

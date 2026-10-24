/* Geometry-based, ideal seat-calibrated PA simulation (metres / seconds).
 * Web Audio panners do NOT simulate speed-of-sound propagation. The delay
 * node therefore holds natural flight time + feed delay + alignment delay.
 * Never add flight time a second time downstream.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.StadiumPA=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const soundSpeed=343;
  const sources={mainL:{x:-31,y:14,z:-54},mainR:{x:31,y:14,z:-54},delayL:{x:-18,y:11,z:-10},delayR:{x:18,y:11,z:-10}};
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function smoothstep(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)}
  function solve(eye){
    const distances={},natural={},weights={};
    const feed=distance(sources.mainL,sources.delayL)/soundSpeed;
    for(const key in sources){distances[key]=distance(eye,sources[key]);natural[key]=distances[key]/soundSpeed+(key.startsWith('delay')?feed:0)}
    // Delay arrays point toward the rear of the field. Side stands and front
    // rows stay mostly on the mains. Equal-power fades keep zone seams smooth.
    const coverage=Math.pow(clamp((eye.z+10)/Math.max(1,(distances.delayL+distances.delayR)/2),0,1),2);
    const blend=smoothstep(-16,22,eye.z)*.78*(.3+.7*coverage);
    for(const group of ['main','delay']){
      const keys=[group+'L',group+'R'];const raw=keys.map(k=>Math.pow(12/Math.max(6,distances[k]),.72));
      const norm=Math.hypot(...raw);const level=group==='main'?Math.sqrt(1-blend):Math.sqrt(blend);
      keys.forEach((key,i)=>weights[key]=raw[i]/norm*level);
    }
    // Align every virtual source at this listening position. Include the
    // fixed main-to-tower feed in the reference, then add only missing delay.
    const target=Math.max(...Object.values(natural));const channels={};
    for(const key in sources){
      const dsp=target-natural[key];
      channels[key]={gain:weights[key],naturalArrival:natural[key],dspDelay:dsp,delay:natural[key]+dsp,distance:distances[key]};
    }
    return {channels,arrival:target,delayBlend:blend,zone:blend<.12?'메인 스피커 구역':blend>.58?'딜레이 타워 구역':'메인·딜레이 전환 구역'};
  }
  return {solve,sources,soundSpeed};
});

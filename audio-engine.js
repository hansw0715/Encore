/* All processing is local Web Audio. No recording, upload or network I/O. */
(function(root){
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
class VenueAudioEngine{
 constructor(ctx,settings){
  this.ctx=ctx;this.nodes=[];this.disposed=false;this.voices=new Set();
  const add=n=>(this.nodes.push(n),n);this.add=add;
  this.input=add(ctx.createGain());this.input.channelCount=2;this.input.channelCountMode='explicit';
  this.original=add(ctx.createGain());this.fx=add(ctx.createGain());this.out=add(ctx.createGain());
  this.drive=add(ctx.createGain());
  this.input.connect(this.original);this.original.connect(this.drive);

  // PA voicing: a little extra low end, like a stadium sub array.
  this.pa=add(ctx.createBiquadFilter());this.pa.type='lowshelf';this.pa.frequency.value=100;this.input.connect(this.pa);
  this.split=add(ctx.createChannelSplitter(2));this.pa.connect(this.split);

  // Direct sound: HRTF-placed speakers (head turning) plus a clean front bed
  // that keeps the original timbre. Both pass the "vocal bite" EQ.
  this.air=add(ctx.createBiquadFilter());this.air.type='highshelf';this.air.frequency.value=9000;
  this.direct=add(ctx.createGain());this.air.connect(this.direct);
  this.bed=add(ctx.createGain());this.pa.connect(this.bed);
  this.bite=add(ctx.createBiquadFilter());this.bite.type='peaking';this.bite.frequency.value=2700;this.bite.Q.value=1.1;
  this.presence=add(ctx.createBiquadFilter());this.presence.type='peaking';this.presence.frequency.value=4800;this.presence.Q.value=.8;
  this.sheen=add(ctx.createBiquadFilter());this.sheen.type='highshelf';this.sheen.frequency.value=8500;
  this.mud=add(ctx.createBiquadFilter());this.mud.type='peaking';this.mud.frequency.value=320;this.mud.Q.value=.9;
  // The clean bed turns with the head too: both channels slide toward the
  // side the stage is on, narrow when it is beside you, and dull behind you.
  this.bedSplit=add(ctx.createChannelSplitter(2));this.bed.connect(this.bedSplit);
  this.bedL=add(ctx.createStereoPanner());this.bedR=add(ctx.createStereoPanner());
  this.bedShadow=add(ctx.createBiquadFilter());this.bedShadow.type='lowpass';this.bedShadow.Q.value=.707;this.bedTurnGain=add(ctx.createGain());
  this.bedSplit.connect(this.bedL,0);this.bedSplit.connect(this.bedR,1);this.bedL.connect(this.bedShadow);this.bedR.connect(this.bedShadow);this.bedShadow.connect(this.bedTurnGain);
  this.direct.connect(this.mud);this.bedTurnGain.connect(this.mud);this.mud.connect(this.bite);this.bite.connect(this.presence);this.presence.connect(this.sheen);this.sheen.connect(this.fx);

  this.channels={};
  for(const [key,ch] of [['mainL',0],['mainR',1],['delayL',0],['delayR',1]]){
   const delay=add(ctx.createDelay(1.5)),gain=add(ctx.createGain()),shadow=add(ctx.createBiquadFilter()),headGain=add(ctx.createGain()),panner=add(ctx.createPanner()),pan=add(ctx.createStereoPanner());
   shadow.type='lowpass';shadow.Q.value=.707;panner.panningModel='HRTF';panner.distanceModel='linear';panner.rolloffFactor=0;
   const p=StadiumPA.sources[key];panner.positionX.value=p.x;panner.positionY.value=p.y;panner.positionZ.value=p.z;
   this.split.connect(delay,ch);delay.connect(gain);gain.connect(shadow);shadow.connect(headGain);headGain.connect(panner);panner.connect(pan);pan.connect(this.air);
   this.channels[key]={delay,gain,shadow,headGain,panner,pan};
  }

  // Stadium room: the whole mix, darker and wide.
  this.roomDelay=add(ctx.createDelay(1.5));this.pa.connect(this.roomDelay);
  this.roomHP=add(ctx.createBiquadFilter());this.roomHP.type='highpass';this.roomHP.frequency.value=260;
  this.conv=add(ctx.createConvolver());this.conv.buffer=this.impulse(3.2,.85,.45,2.8);this.wet=add(ctx.createGain());
  this.roomDelay.connect(this.roomHP);this.roomHP.connect(this.conv);this.conv.connect(this.wet);this.wet.connect(this.fx);

  // Vocal hall: only the centre (where the lead vocal sits), band-limited
  // to the voice, pre-delayed so the words stay crisp, then a long bright tail.
  this.mid=add(ctx.createGain());this.mid.channelCount=1;this.mid.channelCountMode='explicit';this.mid.channelInterpretation='speakers';this.pa.connect(this.mid);
  this.vHP=add(ctx.createBiquadFilter());this.vHP.type='highpass';this.vHP.frequency.value=420;this.vHP.Q.value=.7;
  this.vLP=add(ctx.createBiquadFilter());this.vLP.type='lowpass';this.vLP.frequency.value=8000;this.vLP.Q.value=.7;
  this.vPre=add(ctx.createDelay(.5));this.vPre.delayTime.value=.085;
  this.vConv=add(ctx.createConvolver());this.vConv.buffer=this.impulse(3.4,.95,.2,2.6);
  this.vWet=add(ctx.createGain());
  this.mid.connect(this.vHP);this.vHP.connect(this.vLP);this.vLP.connect(this.vPre);this.vPre.connect(this.vConv);this.vConv.connect(this.vWet);this.vWet.connect(this.fx);

  // Rear-wall slap, the stadium "second voice".
  this.echoDelay=add(ctx.createDelay(1.5));this.echoLP=add(ctx.createBiquadFilter());this.echoLP.type='lowpass';this.echoLP.frequency.value=2400;this.echoGain=add(ctx.createGain());
  this.echoPan=add(ctx.createPanner());this.echoPan.panningModel='HRTF';this.echoPan.rolloffFactor=0;this.echoPan.positionX.value=0;this.echoPan.positionY.value=22;this.echoPan.positionZ.value=110;
  this.vLP.connect(this.echoDelay);this.echoDelay.connect(this.echoLP);this.echoLP.connect(this.echoGain);this.echoGain.connect(this.echoPan);this.echoPan.connect(this.fx);

  // Crowd: a low murmur while music plays, and cheers that erupt when the
  // music starts or kicks in. Everything goes through the crowd bus.
  this.crowdBus=add(ctx.createGain());this.crowdBus.connect(this.fx);
  this.crowdSend=add(ctx.createGain());this.crowdSend.gain.value=.4;this.crowdBus.connect(this.crowdSend);this.crowdSend.connect(this.roomHP);
  this.noiseBuf=this.noise(6);
  this.murmur=add(ctx.createGain());this.murmur.gain.value=0;this.murmur.connect(this.crowdBus);
  this.crowdNoise=add(ctx.createBufferSource());this.crowdNoise.buffer=this.noiseBuf;this.crowdNoise.loop=true;
  // Background crowd: two talking bands that slowly swell and settle, like
  // tens of thousands of people around you, plus distant whoops (see level()).
  this.crowdFilter=add(ctx.createBiquadFilter());this.crowdFilter.type='bandpass';this.crowdFilter.frequency.value=520;this.crowdFilter.Q.value=.7;
  this.crowdFilter2=add(ctx.createBiquadFilter());this.crowdFilter2.type='bandpass';this.crowdFilter2.frequency.value=1250;this.crowdFilter2.Q.value=.9;
  this.crowdSwell=add(ctx.createGain());this.crowdSwell.gain.value=.75;
  this.crowdLfo=add(ctx.createOscillator());this.crowdLfo.frequency.value=.07;this.crowdLfoAmt=add(ctx.createGain());this.crowdLfoAmt.gain.value=.25;this.crowdLfo.connect(this.crowdLfoAmt);this.crowdLfoAmt.connect(this.crowdSwell.gain);this.crowdLfo.start();
  this.crowdNoise.connect(this.crowdFilter);this.crowdNoise.connect(this.crowdFilter2);this.crowdFilter.connect(this.crowdSwell);this.crowdFilter2.connect(this.crowdSwell);this.crowdSwell.connect(this.murmur);this.crowdNoise.start();

  this.limiter=add(ctx.createDynamicsCompressor());this.limiter.threshold.value=-2;this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.003;this.limiter.release.value=.15;
  this.analyser=add(ctx.createAnalyser());this.analyser.fftSize=256;this.analyser.smoothingTimeConstant=.65;
  this.levelData=new Uint8Array(128);this.timeData=new Float32Array(1024);
  this.det={slow:0,quiet:3,last:-99,t:0,cheerAt:-99};
  // Volume sits before the limiter so it can go past 100% without clipping.
  this.fx.connect(this.drive);this.drive.connect(this.limiter);this.limiter.connect(this.out);this.out.connect(this.analyser);this.analyser.connect(ctx.destination);
  this.update(settings,true);
 }
 connect(source){this.source=source;source.connect(this.input)}
 noise(seconds){const c=this.ctx,b=c.createBuffer(2,Math.ceil(c.sampleRate*seconds),c.sampleRate);for(let k=0;k<2;k++){const d=b.getChannelData(k);let b0=0,b1=0,b2=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;b0=.99765*b0+w*.099;b1=.963*b1+w*.2965;b2=.57*b2+w*1.0526;d[i]=(b0+b1+b2+w*.1848)*.12}}return b}
 // Decaying noise IR. bright: lowpass coefficient at the start; dulling: how much it darkens over the tail.
 impulse(seconds,bright,dulling,decay){const c=this.ctx,b=c.createBuffer(2,Math.ceil(c.sampleRate*seconds),c.sampleRate);for(let k=0;k<2;k++){const d=b.getChannelData(k);let lp=0;for(let i=0;i<d.length;i++){const t=i/d.length;lp+=((Math.random()*2-1)-lp)*(bright-dulling*t);d[i]=lp*Math.pow(1-t,decay)}}return b}
 param(param,value,immediate=false,time=.045){if(immediate)param.value=value;else param.setTargetAtTime(value,this.ctx.currentTime,time)}
 update(settings,immediate=false){
  this.settings=VenueSettings.clean(settings);const s=this.settings,e=s.seat,f=s.forward,c=this.ctx;const set=(p,v,t)=>this.param(p,v,immediate,t);
  this.calibration=StadiumPA.solve(e);const pa=this.calibration;
  const common=s.latencyMode==='distance'?pa.arrival:0;
  for(const key in this.channels){const ch=this.channels[key],model=pa.channels[key];set(ch.delay.delayTime,Math.max(0,model.delay-pa.arrival+common),.08);set(ch.gain.gain,model.gain,.12);
   const p=StadiumPA.sources[key],d=Math.max(.001,Math.hypot(p.x-e.x,p.y-e.y,p.z-e.z)),vx=(p.x-e.x)/d,vy=(p.y-e.y)/d,vz=(p.z-e.z)/d;
   const lr=clamp(-f.z*vx+f.x*vz,-1,1),rear=Math.max(0,-(f.x*vx+f.y*vy+f.z*vz));
   set(ch.shadow.frequency,20000-rear*s.head*15000);set(ch.headGain.gain,1-rear*s.head*.4);set(ch.pan.pan,clamp(lr*s.head*1.1,-1,1));
  }
  {const p={x:0,y:14,z:-54},d=Math.max(.001,Math.hypot(p.x-e.x,p.y-e.y,p.z-e.z)),vx=(p.x-e.x)/d,vy=(p.y-e.y)/d,vz=(p.z-e.z)/d;
   const lr=clamp(-f.z*vx+f.x*vz,-1,1),front=f.x*vx+f.y*vy+f.z*vz,rear=Math.max(0,-front),h=s.head,width=.75*(1-h*.8*Math.abs(lr));
   set(this.bedL.pan,clamp(-width+lr*h*1.15,-1,1),.06);set(this.bedR.pan,clamp(width+lr*h*1.15,-1,1),.06);
   set(this.bedShadow.frequency,20000-rear*h*15000,.08);set(this.bedTurnGain.gain,1-rear*h*.35,.08);}
  const l=c.listener;for(const [name,value] of Object.entries({positionX:e.x,positionY:e.y,positionZ:e.z,forwardX:f.x,forwardY:f.y,forwardZ:f.z,upX:0,upY:1,upZ:0}))set(l[name],value);
  set(this.roomDelay.delayTime,common+.018,.08);
  const nearest=Math.min(...Object.values(pa.channels).filter(ch=>ch.gain>.1).map(ch=>ch.distance)),roof=!e.floor&&e.y>14;
  // Slider scales: clarity 50 = the old 100, reverb up to 1.8x the old max, volume up to 2.5x.
  const cl=s.clarity*2,rv=s.rev*1.8,bedMix=Math.min(cl,1.3);
  set(this.air.gain,-Math.min(6,nearest*.035),.15);
  set(this.direct.gain,.62*Math.max(.55,1-nearest/300)*Math.max(.12,1-cl*.45),.15);set(this.bed.gain,.7*bedMix,.15);set(this.pa.gain,2.5);
  set(this.mud.gain,-cl*3,.15);set(this.bite.gain,cl*3,.15);set(this.presence.gain,Math.min(9,1+cl*4.5),.15);set(this.sheen.gain,Math.min(8,1+cl*3.5),.15);
  set(this.wet.gain,rv*(.08+Math.min(.26,nearest/300))*(roof?1.1:1),.15);
  set(this.vWet.gain,rv*.62,.15);
  set(this.echoDelay.delayTime,clamp(((164+110-e.z)-pa.channels.mainL.distance)/343,.12,1.1),.15);
  set(this.echoGain.gain,rv*.11,.15);
  set(this.original.gain,s.enabled?0:1,.018);set(this.fx.gain,s.enabled?1:0,.018);set(this.drive.gain,s.vol*2.5,.06);
 }
 // A stadium cheer: broadband roar + a low "woah" + scattered screams.
 cheer(power=1){
  const c=this.ctx,t=c.currentTime+.04,amp=this.settings.crowd*power,keep=[];
  if(amp<.01)return;
  const layer=(freq,q,peak,attack,hold,tail)=>{
   const s=c.createBufferSource();s.buffer=this.noiseBuf;s.playbackRate.value=.9+Math.random()*.2;
   const bp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=freq;bp.Q.value=q;
   const g=c.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak*amp,t+attack);g.gain.setTargetAtTime(peak*amp*.7,t+attack,hold);g.gain.setTargetAtTime(0,t+attack+hold,tail);
   s.connect(bp);bp.connect(g);g.connect(this.crowdBus);s.start(t,Math.random()*3);s.stop(t+attack+hold+tail*5);keep.push(s,bp,g);
  };
  layer(1150,.45,1.1,.45,1.4,1.1);
  layer(420,.9,.7,.7,1.6,1.3);
  layer(2600,1.2,.35,.3,.8,.6);
  for(let i=0;i<22;i++){
   const ts=t+Math.random()*1.4,len=.5+Math.random()*1.3,f0=620+Math.random()*760;
   const o=c.createOscillator();o.type=i%3?'triangle':'sawtooth';
   o.frequency.setValueAtTime(f0,ts);o.frequency.linearRampToValueAtTime(f0*(1.15+Math.random()*.2),ts+len*.3);o.frequency.linearRampToValueAtTime(f0*.9,ts+len);
   const vib=c.createOscillator(),vg=c.createGain();vib.frequency.value=5+Math.random()*2.5;vg.gain.value=f0*.018;vib.connect(vg);vg.connect(o.frequency);
   const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=3200;
   const g=c.createGain();g.gain.setValueAtTime(0,ts);g.gain.linearRampToValueAtTime(.011*amp,ts+.08);g.gain.setTargetAtTime(0,ts+len*.6,len*.25);
   const p=c.createStereoPanner();p.pan.value=Math.random()*1.8-.9;
   o.connect(lp);lp.connect(g);g.connect(p);p.connect(this.crowdBus);o.start(ts);vib.start(ts);o.stop(ts+len+1);vib.stop(ts+len+1);keep.push(o,vib,vg,lp,g,p);
  }
  const bundle={keep};this.voices.add(bundle);
  setTimeout(()=>{for(const n of keep)try{n.disconnect()}catch(e){}this.voices.delete(bundle)},9000);
  this.det.cheerAt=c.currentTime;
 }
 // One distant fan somewhere in the stands: a short whoop or a few claps.
 whoop(){
  const c=this.ctx,t=c.currentTime+.05,amp=this.settings.crowd,keep=[],p=c.createStereoPanner();p.pan.value=Math.random()*1.8-.9;
  const lp=c.createBiquadFilter();lp.type='lowpass';lp.frequency.value=2200;lp.connect(p);p.connect(this.crowdBus);keep.push(p,lp);
  if(Math.random()<.6){const o=c.createOscillator(),g=c.createGain(),f0=600+Math.random()*500,len=.4+Math.random()*.6;o.type='triangle';
   o.frequency.setValueAtTime(f0,t);o.frequency.linearRampToValueAtTime(f0*1.3,t+len*.4);o.frequency.linearRampToValueAtTime(f0*.95,t+len);
   g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.012*amp,t+.06);g.gain.setTargetAtTime(0,t+len*.5,len*.25);o.connect(g);g.connect(lp);o.start(t);o.stop(t+len+.8);keep.push(o,g)}
  else for(let i=0,n=3+Math.floor(Math.random()*4);i<n;i++){const s=c.createBufferSource(),bp=c.createBiquadFilter(),g=c.createGain(),ts=t+i*(.28+Math.random()*.05);s.buffer=this.noiseBuf;bp.type='bandpass';bp.frequency.value=1500;bp.Q.value=1.2;
   g.gain.setValueAtTime(.05*amp,ts);g.gain.setTargetAtTime(0,ts+.005,.02);s.connect(bp);bp.connect(g);g.connect(lp);s.start(ts,Math.random()*4,.15);keep.push(s,bp,g)}
  const bundle={keep};this.voices.add(bundle);setTimeout(()=>{for(const n of keep)try{n.disconnect()}catch(e){}this.voices.delete(bundle)},4000);
 }
 level(){
  if(this.disposed)return {bass:0,level:0,input:0,cheer:false};
  if(!this.inputAnalyser){this.inputAnalyser=this.add(this.ctx.createAnalyser());this.inputAnalyser.fftSize=1024;this.input.connect(this.inputAnalyser)}
  this.inputAnalyser.getFloatTimeDomainData(this.timeData);let sum=0;for(const x of this.timeData)sum+=x*x;const rms=Math.sqrt(sum/this.timeData.length);
  const now=this.ctx.currentTime,d=this.det,dt=clamp(now-(d.t||now),0,1);d.t=now;
  const s=this.settings,playing=rms>.004;
  // Cheer when music starts after a pause, or when it suddenly kicks in.
  if(s.enabled&&now-d.last>6){
   if(rms>.02&&d.quiet>=1.2){this.cheer(1);d.last=now}
   else if(rms>.035&&d.slow<.06&&rms>d.slow*3.2&&now-d.last>25){this.cheer(.8);d.last=now}
  }
  d.quiet=playing?0:d.quiet+dt;d.slow+=(rms-d.slow)*Math.min(1,dt/5);
  this.murmur.gain.setTargetAtTime(playing?s.crowd*.22:0,now,playing?.6:.4);
  if(playing&&s.enabled&&s.crowd>.01&&now>(d.nextWhoop||0)){this.whoop();d.nextWhoop=now+2.5+Math.random()*5}
  this.analyser.getByteFrequencyData(this.levelData);let bass=0,mean=0;for(let i=1;i<7;i++)bass+=this.levelData[i];for(let i=0;i<64;i++)mean+=this.levelData[i];
  return {bass:bass/6/255,level:mean/64/255,input:rms,cheer:now-d.cheerAt<.3};
 }
 dispose(){this.disposed=true;try{this.crowdNoise.stop();this.crowdLfo.stop()}catch(e){}try{this.source?.disconnect()}catch(e){}for(const b of this.voices)for(const n of b.keep)try{n.disconnect()}catch(e){}for(const node of this.nodes)try{node.disconnect()}catch(e){}}
}
root.VenueAudioEngine=VenueAudioEngine;
})(typeof globalThis!=='undefined'?globalThis:this);

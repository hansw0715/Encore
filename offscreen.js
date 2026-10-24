let engine=null,stream=null,ctx=null,timer=null,operation=0;
let settings=VenueSettings.clean();
let session={status:'idle',tabId:null,title:'연결된 탭 없음',error:''};
const tell=(type,extra={})=>chrome.runtime.sendMessage({target:'worker',type,...extra}).catch(()=>{});
async function stop(notify=true){
 operation++;clearInterval(timer);timer=null;
 if(stream){for(const track of stream.getTracks()){track.onended=null;track.stop()}stream=null}
 if(engine){engine.dispose();engine=null}if(ctx){const old=ctx;ctx=null;await old.close().catch(()=>{})}
 session={status:'idle',tabId:null,title:'연결된 탭 없음',error:''};if(notify)await tell('AUDIO_STATUS',{session});
}
async function start(message){
 await stop(false);const token=operation;
 settings=VenueSettings.clean(message.settings);
 let acquired=null,timeout;
 try{
  // This is tab audio only. There is no microphone request or recording.
  const pending=navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId}},video:false});
  pending.then(result=>{if(token!==operation)result.getTracks().forEach(t=>t.stop())},()=>{});
  acquired=await Promise.race([pending,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('탭 오디오 연결 시간이 초과되었습니다.')),12000)})]);clearTimeout(timeout);
  if(token!==operation){acquired.getTracks().forEach(t=>t.stop());return {ok:false,error:'연결이 취소되었습니다.'}}
  stream=acquired;ctx=new AudioContext({latencyHint:'interactive'});engine=new VenueAudioEngine(ctx,settings);engine.connect(ctx.createMediaStreamSource(stream));await ctx.resume();
  if(token!==operation)return {ok:false,error:'연결이 취소되었습니다.'};
  session={status:'active',tabId:message.tabId,title:message.title,error:''};
  stream.getAudioTracks().forEach(track=>track.onended=()=>stop().catch(console.error));
  ctx.onstatechange=()=>{if(ctx&&ctx.state==='suspended')tell('AUDIO_STATUS',{session:{...session,error:'오디오가 일시 중단되었습니다. 확장 연결을 해제한 뒤 다시 눌러주세요.'}})};
  timer=setInterval(()=>{if(engine)tell('AUDIO_LEVEL',{level:engine.level()})},120);
  return {ok:true,session};
 }catch(error){clearTimeout(timeout);if(token===operation)await stop(false);else acquired?.getTracks().forEach(t=>t.stop());return {ok:false,error:error.message}}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.target!=='audio'||sender.id!==chrome.runtime.id)return;
 (async()=>{
  switch(message.type){
   case 'GET_STATUS':return {ok:true,session,settings};
   case 'START':return start(message);
   case 'STOP':await stop(false);return {ok:true,session};
   case 'SETTINGS':settings=VenueSettings.clean(message.settings);engine?.update(settings);return {ok:true};
   default:return {ok:false,error:'지원하지 않는 오디오 요청입니다.'};
  }
 })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
});

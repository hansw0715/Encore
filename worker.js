importScripts('settings.js');
let creating=null,busy=false,saveTimer;
const OFFSCREEN='offscreen.html';
const empty=()=>({status:'idle',tabId:null,title:'연결된 탭 없음',error:'',settings:VenueSettings.clean()});
let state=empty();
const SCHEMA=4;
const initialized=(async()=>{const [local,session]=await Promise.all([chrome.storage.local.get(['settings','schema']),chrome.storage.session.get('session')]);
 // Older versions stored seat and mix values that this version no longer exposes; start from the new defaults once.
 let saved=local.settings||{};
 if(local.schema===3){const k=(v,d)=>typeof v==='number'?v/d:undefined;saved={...saved,clarity:k(saved.clarity,2),rev:k(saved.rev,1.8),vol:k(saved.vol,2.5)};await chrome.storage.local.set({settings:VenueSettings.clean(saved),schema:SCHEMA})}
 else if(local.schema!==SCHEMA){saved={enabled:saved.enabled,head:saved.head};await chrome.storage.local.set({settings:VenueSettings.clean(saved),schema:SCHEMA})}
 state={...empty(),...(session.session||{}),settings:VenueSettings.clean(saved)}})();
const audio=message=>chrome.runtime.sendMessage({target:'audio',...message});
async function hasOffscreen(){return (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL(OFFSCREEN)]})).length>0}
async function ensureOffscreen(){
 if(await hasOffscreen())return;
 if(!creating)creating=chrome.offscreen.createDocument({url:OFFSCREEN,reasons:['USER_MEDIA'],justification:'현재 탭의 소리를 컴퓨터 안에서 공연장 효과로 처리하고 재생합니다.'}).finally(()=>creating=null);
 await creating;
}
async function publish(){
 await chrome.storage.session.set({session:{status:state.status,tabId:state.tabId,title:state.title,error:state.error}});
 await chrome.action.setBadgeText({text:state.status==='active'?(state.settings.enabled?'ON':'RAW'):state.status==='connecting'?'…':''});
 await chrome.action.setBadgeBackgroundColor({color:state.settings.enabled?'#a57d3d':'#48566b'});
 chrome.runtime.sendMessage({target:'ui',type:'STATE',state}).catch(()=>{});
}
async function freshState(){
 await initialized;
 if(await hasOffscreen()){
  try{const response=await audio({type:'GET_STATUS'});if(response?.ok){state={...state,...response.session,settings:VenueSettings.clean(response.settings||state.settings)}}}catch(e){state.status='idle';state.tabId=null}
 }else if(state.status==='active'||state.status==='connecting'){state.status='idle';state.tabId=null;state.title='연결된 탭 없음'}
 return state;
}
async function startCapture(tab){
 await initialized;
 if(busy)return {ok:false,error:'연결 중입니다. 잠시 기다려주세요.'};
 if(!tab?.id||!/^https?:\/\//.test(tab.url||''))return {ok:false,error:'소리가 나는 웹페이지 탭으로 이동한 뒤 상단 ENCORE 아이콘을 클릭해주세요.'};
 busy=true;
 try{
  await ensureOffscreen();const existing=await audio({type:'GET_STATUS'});
  if(existing?.session?.status==='active'&&existing.session.tabId===tab.id){await freshState();await publish();return {ok:true,state}}
  // Capture must be requested from an explicit toolbar/extension click.
  const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
  state={...state,status:'connecting',error:'',tabId:tab.id,title:tab.title||'현재 탭'};await publish();
  const reply=await audio({type:'START',streamId,tabId:tab.id,title:state.title,settings:state.settings});
  if(!reply?.ok)throw Error(reply?.error||'오디오 연결에 실패했습니다.');
  state={...state,...reply.session};await publish();return {ok:true,state};
 }catch(e){
  let surviving=null;try{surviving=await audio({type:'GET_STATUS'})}catch(ignore){}
  state={...state,...(surviving?.session||{status:'idle',tabId:null,title:'연결된 탭 없음'}),error:'연결 실패: '+e.message+' 소리가 나는 탭에서 ENCORE 아이콘을 다시 눌러주세요.'};await publish();return {ok:false,error:state.error,state};
 }finally{busy=false}
}
async function listTabs(){
 const tabs=await chrome.tabs.query({});
 return tabs.filter(t=>/^https?:\/\//.test(t.url||'')).map(t=>{let host='';try{host=new URL(t.url).hostname.replace(/^www\./,'')}catch(e){}
  return {id:t.id,title:t.title||host,host,audible:!!t.audible,active:!!t.active,connected:state.status==='active'&&state.tabId===t.id}});
}
let tabsTimer=null;
chrome.tabs.onUpdated.addListener((id,info)=>{if('audible' in info||'title' in info){clearTimeout(tabsTimer);tabsTimer=setTimeout(()=>chrome.runtime.sendMessage({target:'ui',type:'TABS_CHANGED'}).catch(()=>{}),300)}});
async function stopCapture(){
 await initialized;if(await hasOffscreen())await audio({type:'STOP'});
 state={...state,status:'idle',tabId:null,title:'연결된 탭 없음',error:''};await publish();return {ok:true,state};
}
chrome.action.onClicked.addListener(tab=>{
 // Open synchronously in the gesture handler; don't await before .open().
 chrome.sidePanel.open({windowId:tab.windowId}).catch(()=>{});
 startCapture(tab).catch(console.error);
});
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.target!=='worker'||sender.id!==chrome.runtime.id)return;
 (async()=>{
  await initialized;
  switch(message.type){
   case 'GET_STATE':return {ok:true,state:await freshState()};
   case 'START':{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});return startCapture(tab)}
   case 'STOP':return stopCapture();
   case 'LIST_TABS':return {ok:true,tabs:await listTabs()};
   case 'START_TAB':{
    let tab;try{tab=await chrome.tabs.get(message.tabId)}catch(e){return {ok:false,error:'그 탭이 닫혔어요. 목록에서 다른 탭을 골라주세요.'}}
    const res=await startCapture(tab);if(res.ok)return res;
    // Chrome only lets an extension capture a tab after it was invoked on that tab.
    // Bring the tab forward so one click on the toolbar icon finishes the job.
    try{await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true})}catch(e){}
    state.error='';await publish();
    return {ok:false,needsClick:true,error:`"${(tab.title||'그 탭').slice(0,40)}" 탭으로 이동했어요. 주소창 오른쪽 ENCORE 아이콘을 한 번 누르면 연결돼요.`};
   }
   case 'PATCH':{
    state.settings=VenueSettings.clean(message.patch||{},state.settings);
    clearTimeout(saveTimer);saveTimer=setTimeout(()=>chrome.storage.local.set({settings:state.settings}),350);
    if(await hasOffscreen())await audio({type:'SETTINGS',settings:state.settings});
    await publish();return {ok:true,state};
   }
   case 'AUDIO_STATUS':state={...state,...message.session};await publish();return {ok:true};
   case 'AUDIO_LEVEL':chrome.runtime.sendMessage({target:'ui',type:'LEVEL',level:message.level}).catch(()=>{});return {ok:true};
   default:return {ok:false,error:'알 수 없는 요청입니다.'};
  }
 })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
 return true;
});
chrome.tabs.onRemoved.addListener(async id=>{await initialized;if(state.tabId===id)stopCapture().catch(console.error)});
chrome.runtime.onInstalled.addListener(()=>{chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{})});

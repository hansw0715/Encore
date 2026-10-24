const $=id=>document.getElementById(id);
const extensionAvailable=Boolean(globalThis.chrome?.runtime?.id);
let current=VenueSettings.clean(),session={status:'idle',title:''};
let patchQueue={},patchTimer=null;
const say=text=>{$('status').textContent=text||''};

/* Head direction: angle in degrees from "facing the stage", positive = right. */
const STAGE={x:0,y:10,z:-54};
function stageDir(seat){const dx=STAGE.x-seat.x,dy=STAGE.y-seat.y,dz=STAGE.z-seat.z;return {yaw:Math.atan2(dx,dz),pitch:Math.atan2(dy,Math.hypot(dx,dz))}}
function forwardFor(seat,deg){const d=stageDir(seat),r=deg*Math.PI/180,yaw=d.yaw-r,p=d.pitch*Math.max(0,Math.cos(r));return {x:Math.sin(yaw)*Math.cos(p),y:Math.sin(p),z:Math.cos(yaw)*Math.cos(p)}}
function turnFrom(seat,f){const d=stageDir(seat);let a=(d.yaw-Math.atan2(f.x,f.z))*180/Math.PI;while(a>180)a-=360;while(a<-180)a+=360;return Math.round(a/5)*5}
const turnWords=a=>a===0?'무대 정면':Math.abs(a)===180?'무대 반대편':(a<0?'왼쪽 ':'오른쪽 ')+Math.abs(a)+'°';

async function send(type,extra={}){
 if(!extensionAvailable)throw Error('미리보기라서 탭 소리를 연결할 수 없어요. 크롬에 설치한 뒤 사용하세요.');
 const reply=await chrome.runtime.sendMessage({target:'worker',type,...extra});
 if(!reply?.ok)throw Error(reply?.error||'확장프로그램과 연결하지 못했어요. 확장프로그램을 새로고침한 뒤 다시 열어주세요.');
 return reply;
}
function patch(value){
 current=VenueSettings.clean(value,current);Object.assign(patchQueue,value);if(patchTimer)return;
 patchTimer=setTimeout(async()=>{patchTimer=null;const next=patchQueue;patchQueue={};try{applyState((await send('PATCH',{patch:next})).state)}catch(e){say(e.message)}},30);
}

/* ---------- dial ---------- */
const dial=$('dial');let turn=0,dragging=false;
(function ticks(){const g=$('ticks'),ns='http://www.w3.org/2000/svg';for(let a=0;a<360;a+=15){const major=a%90===0,r1=major?84:87,r2=92,t=(a-90)*Math.PI/180;
 if(a===0)continue;const l=document.createElementNS(ns,'line');l.setAttribute('x1',100+r1*Math.cos(t));l.setAttribute('y1',100+r1*Math.sin(t));l.setAttribute('x2',100+r2*Math.cos(t));l.setAttribute('y2',100+r2*Math.sin(t));if(major)l.setAttribute('class','major');g.appendChild(l)}})();
function showTurn(a){
 turn=a;dial.style.setProperty('--turn',a+'deg');
 $('turnText').textContent=turnWords(a);dial.setAttribute('aria-valuenow',a);dial.setAttribute('aria-valuetext',turnWords(a));
 $('recenter').disabled=a===0;
}
function setTurn(a){a=Math.max(-180,Math.min(180,Math.round(a/5)*5));if(a===turn)return;showTurn(a);patch({forward:forwardFor(current.seat,a)})}
function angleAt(e){const r=dial.getBoundingClientRect(),x=e.clientX-(r.left+r.width/2),y=e.clientY-(r.top+r.height/2);return Math.atan2(x,-y)*180/Math.PI}
dial.addEventListener('pointerdown',e=>{dragging=true;dial.classList.add('dragging');dial.setPointerCapture(e.pointerId);setTurn(angleAt(e))});
dial.addEventListener('pointermove',e=>{if(dragging)setTurn(angleAt(e))});
const endDrag=()=>{dragging=false;dial.classList.remove('dragging')};
dial.addEventListener('pointerup',endDrag);dial.addEventListener('pointercancel',endDrag);
dial.addEventListener('keydown',e=>{const step=e.shiftKey?30:5;
 if(e.key==='ArrowLeft'||e.key==='ArrowDown'){setTurn(turn-step);e.preventDefault()}
 else if(e.key==='ArrowRight'||e.key==='ArrowUp'){setTurn(turn+step);e.preventDefault()}
 else if(e.key==='Home'){setTurn(0);e.preventDefault()}});
$('recenter').onclick=()=>setTurn(0);

/* ---------- faders ---------- */
const KEYS=['clarity','rev','crowd','head','vol'];
function paint(input){input.style.setProperty('--p',input.value+'%')}
for(const key of KEYS){const el=$(key);el.addEventListener('input',()=>{$(key+'O').textContent=el.value;paint(el);patch({[key]:Number(el.value)/100})});paint(el)}

/* ---------- switch ---------- */
$('effect').onclick=()=>patch({enabled:!current.enabled});

/* ---------- link ---------- */
$('linkBtn').onclick=async()=>{try{applyState((await send('STOP')).state);say('');refreshTabs()}catch(e){say(e.message)}};

/* ---------- tab picker: choose exactly which tab gets the stadium sound ---------- */
const pick=$('tabPick'),list=$('tabList');let tabs=[];
const speaker='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 5.2a3.5 3.5 0 0 1 0 5.6l-.8-1a2.2 2.2 0 0 0 0-3.6zM12.4 3a6.3 6.3 0 0 1 0 10l-.8-1a5 5 0 0 0 0-8z"/></svg>';
async function refreshTabs(){
 if(!extensionAvailable)return;
 try{tabs=(await send('LIST_TABS')).tabs}catch(e){return}
 const on=tabs.find(t=>t.connected);$('tabPickTitle').textContent=on?on.title:'탭을 골라주세요';pick.title=on?on.title:'';
 if(!list.hidden)renderList();
}
function row(t){
 const li=document.createElement('li'),b=document.createElement('button');b.type='button';
 const title=document.createElement('span');title.className='t';title.textContent=t.title;
 const host=document.createElement('span');host.className='h';host.textContent=t.host;
 const tag=document.createElement('span');tag.className='tag'+(t.connected?' on':'');
 if(t.connected)tag.textContent='적용 중';else if(t.audible)tag.innerHTML=speaker+'<span>소리 나는 중</span>';
 b.append(title,tag,host);b.addEventListener('click',()=>choose(t));li.appendChild(b);return li;
}
function renderList(){
 list.textContent='';
 if(!tabs.length){const p=document.createElement('li');p.className='empty';p.textContent='열려 있는 웹페이지 탭이 없어요.';list.appendChild(p);return}
 const sorted=[...tabs].sort((a,b)=>(b.connected-a.connected)||(b.audible-a.audible)||(b.active-a.active));
 const loud=sorted.filter(t=>t.connected||t.audible),rest=sorted.filter(t=>!t.connected&&!t.audible);
 const head=txt=>{const li=document.createElement('li');li.className='group';li.textContent=txt;return li};
 if(loud.length){list.appendChild(head('소리 나는 탭'));loud.forEach(t=>list.appendChild(row(t)))}
 if(rest.length){list.appendChild(head(loud.length?'다른 탭':'열린 탭'));rest.forEach(t=>list.appendChild(row(t)))}
}
function openList(open){list.hidden=!open;pick.setAttribute('aria-expanded',String(open));if(open){renderList();refreshTabs();list.querySelector('button')?.focus()}}
pick.addEventListener('click',()=>openList(list.hidden));
document.addEventListener('click',e=>{if(!list.hidden&&!e.target.closest('.picker'))openList(false)});
list.addEventListener('keydown',e=>{if(e.key==='Escape'){openList(false);pick.focus()}
 const bs=[...list.querySelectorAll('button')],i=bs.indexOf(document.activeElement);
 if(e.key==='ArrowDown'&&i<bs.length-1){bs[i+1].focus();e.preventDefault()}if(e.key==='ArrowUp'&&i>0){bs[i-1].focus();e.preventDefault()}});
async function choose(t){
 openList(false);if(t.connected)return;
 say('');$('link').dataset.state='connecting';$('linkText').textContent='연결하는 중';$('tabPickTitle').textContent=t.title;
 try{const r=await chrome.runtime.sendMessage({target:'worker',type:'START_TAB',tabId:t.id});
  if(r?.ok)applyState(r.state);else{applyState(session);say(r?.error||'연결하지 못했어요. 그 탭에서 ENCORE 아이콘을 눌러주세요.')}}
 catch(e){applyState(session);say(e.message)}
 refreshTabs();
}
setInterval(()=>{if(!document.hidden)refreshTabs()},4000);

function applyState(state){
 if(!state)return;session=state;current=VenueSettings.clean(state.settings||current);
 const st=state.status==='active'?'active':state.status==='connecting'?'connecting':'idle';
 $('link').dataset.state=st;
 $('linkText').textContent=st==='active'?'탭 오디오 연결됨':st==='connecting'?'연결하는 중':'연결 안 됨';
 $('linkText').title=st==='active'?state.title||'':'';
 $('linkBtn').hidden=st==='idle';$('linkBtn').textContent='해제';
 if(st==='active'&&!state.error)say('');
 if(st==='active')$('tabPickTitle').textContent=state.title||'연결된 탭';else if(st==='idle')$('tabPickTitle').textContent='탭을 골라주세요';
 $('effect').setAttribute('aria-checked',String(current.enabled));
 $('effectText').textContent=current.enabled?'스타디움 울림과 관객 소리를 더해 들려줘요.':'꺼져 있어요. 원래 탭 소리 그대로 들려요.';
 document.body.classList.toggle('effect-off',!current.enabled);
 for(const key of KEYS){const el=$(key);if(document.activeElement!==el){el.value=Math.round(current[key]*100);paint(el)}$(key+'O').textContent=Math.round(current[key]*100)}
 if(!dragging)showTurn(turnFrom(current.seat,current.forward));
 if(st!=='active')level({input:0,level:0});
 if(state.error)say(state.error);
}

/* ---------- live level + cheer ---------- */
const bars=[...document.querySelectorAll('.meter i')];let lastRoar=0;
function level(l){
 const v=Math.min(1,(l.input||0)*7);bars.forEach((b,i)=>b.style.transform='scaleY('+Math.max(.2,Math.min(1,v*(1.25-i*.18)+Math.random()*.08*v))+')');
 document.documentElement.style.setProperty('--lvl',Math.min(1,(l.level||0)*1.6).toFixed(3));
 if(l.cheer&&performance.now()-lastRoar>2500){lastRoar=performance.now();const s=$('stage');s.classList.remove('roar');void s.getBoundingClientRect();s.classList.add('roar')}
}
if(extensionAvailable)chrome.runtime.onMessage.addListener(m=>{
 if(m?.target!=='ui')return;
 if(m.type==='STATE'){applyState(m.state);refreshTabs()}
 if(m.type==='TABS_CHANGED')refreshTabs();
 if(m.type==='LEVEL'&&session.status==='active')level(m.level);
});
(async()=>{try{applyState((await send('GET_STATE')).state);refreshTabs()}catch(e){say(e.message);applyState({status:'idle',settings:current})}})();

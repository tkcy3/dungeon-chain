/* Dungeon Chain — AI実況収録モード（URLに ?rec を付けて開いたときだけ読み込まれる）
   AI実況者「ヒヨリ」がプレイと実況を行い、字幕・音声・効果音つきの縦長動画（9:16）として保存する。
   データは「hiyori:」付きのキーに保存され、普段のプレイのセーブ・実績とは混ざらない。
   AIは Gemini API（テキスト：手と台詞を考える／TTS：声）を使う。APIキーはこの端末の中にだけ保存する。 */
'use strict';
(function(){
const el=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const W=720,H=1280,BX=15,BY=222,BS=690,CELL=BS/6;
const API='https://generativelanguage.googleapis.com/v1beta';
/* 料金（2026年11月時点の公式単価、USD/トークン）。TTSは2027/1/1(JST)から2倍 */
const PRICE={textIn:.30e-6,textOut:2.50e-6,ttsIn:.50e-6,ttsOut:()=>Date.now()>=Date.UTC(2026,11,31,15)?12e-6:6e-6};
const YEN=150;

/* ---------- 保存データ（自動で hiyori: 付きのキーになる） ---------- */
const K={cfg:'hiyori_cfg_v1',key:'hiyori_key_v1',chr:'hiyori_char_v1',dc:'hiyori_dc_v1',snap:'hiyori_snap_v1',cost:'hiyori_cost_v1'};
const jget=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}};
const jset=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}};
const CFG=Object.assign({textModel:'gemini-3.5-flash-lite',ttsModel:'gemini-3.8-flash-lite-tts',voice:'Leda',minutes:10,heta:2},jget(K.cfg,{}));
let KEY='';try{KEY=localStorage.getItem(K.key)||'';}catch(e){}
/* キャラ共通（どのゲームでも引き継ぐ）とゲームごとのデータを分ける */
const CHR=Object.assign({v:1,deaths:0,hiyori:0,topics:[],games:['Dungeon Chain']},jget(K.chr,{}));
const DC=Object.assign({episode:0,notes:[],seen:{},known:{},history:[],midRun:false,newCls:null},jget(K.dc,{}));
const COST=Object.assign({total:0},jget(K.cost,{}));
const saveData=()=>{jset(K.chr,CHR);jset(K.dc,DC);};
const saveCfg=()=>jset(K.cfg,CFG);
function addCost(usd){if(!(usd>0))return;COST.total+=usd;jset(K.cost,COST);if(RUN)RUN.cost+=usd;}
const yen=usd=>Math.round(usd*YEN*10)/10;

const VOICES=[['Leda','若々しい'],['Zephyr','明るい'],['Autonoe','明るい'],['Laomedeia','ノリがいい'],['Aoede','さわやか'],['Pulcherrima','はきはき'],['Erinome','はっきり'],['Kore','しっかり'],['Despina','なめらか'],['Callirrhoe','のんびり'],['Achernar','やわらか'],['Vindemiatrix','やさしい'],['Sulafat','あたたかい'],['Gacrux','大人っぽい']];
const STY={normal:'casual and cheerful young Japanese woman streaming a video game, natural and lively',excited:'very excited and hyped up, speaking fast',panic:'panicking, frantic and loud',scream:'screaming in shock and frustration',sad:'deflated and disappointed',smug:'smug, playful and proud',calm:'relaxed, chatty and friendly',hiyori:'sheepish and embarrassed, a little mumbling',whisper:'nervous whisper'};
const EMO_COL={normal:'#ffffff',excited:'#ffe14a',panic:'#ff8080',scream:'#ff5a5a',sad:'#a9c2ff',smug:'#ffc85a',calm:'#dff4ff',hiyori:'#ffb8dc',whisper:'#d6ceff'};
const EMOS=Object.keys(STY);
const SES=['none','dodon','jaan','chiin','pirorin','gogogo','gyaa','kira','boo','dun','pon'];
const strip=t=>String(t||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&amp;/g,'&').replace(/[ \t]{2,}/g,' ').trim();
const noTags=t=>String(t||'').replace(/<[^>]*>/g,'').replace(/\s{2,}/g,' ').trim();
const fmtT=ms=>{const s=Math.max(0,Math.floor(ms/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
const targetMs=()=>CFG.minutes*60000;

/* ---------- Gemini API ---------- */
function apiMsg(st,m){
  if(/API key not valid|API_KEY_INVALID/i.test(m))return 'APIキーが正しくありません';
  if(st===401||st===403)return 'APIキーが使えません（キーの制限設定と、Gemini APIが有効か確認してください）';
  if(st===402)return 'クレジット残高がありません（AI Studioの「お支払い」でチャージしてください）';
  if(st===429)return '回数の上限に達しました（無料枠の上限か、短時間に呼びすぎ）。少し待つか、課金設定を確認してください';
  if(st===404)return 'モデルが見つかりません（設定のモデル名を確認してください）';
  if(st===400)return 'リクエストが受け付けられませんでした';
  return `通信エラー（${st}）`;}
async function api(url,body,tries=3){
  let last=null;
  for(let i=0;i<tries;i++){
    let r;try{r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':KEY},body:JSON.stringify(body)});}
    catch(e){last=Object.assign(new Error('通信できませんでした（電波を確認してください）'),{status:0});await sleep(1500*(i+1));continue;}
    if(r.ok)return r.json();
    let raw='';try{const j=await r.json();raw=(j.error&&j.error.message)||JSON.stringify(j).slice(0,300);}catch(e){}
    last=Object.assign(new Error(apiMsg(r.status,raw)),{status:r.status,raw});
    if(r.status===429||r.status>=500){await sleep(2500*(i+1));continue;}
    break;}
  throw last;}
function parseJson(t){t=String(t||'').trim().replace(/^```(?:json)?/i,'').replace(/```\s*$/,'').trim();
  try{return JSON.parse(t);}catch(e){const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1));}catch(e2){}}}return null;}
async function llm(sys,user){
  const j=await api(`${API}/models/${encodeURIComponent(CFG.textModel)}:generateContent`,{
    systemInstruction:{parts:[{text:sys}]},contents:[{role:'user',parts:[{text:user}]}],
    generationConfig:{responseMimeType:'application/json',temperature:1,maxOutputTokens:3000}});
  const u=j.usageMetadata||{};addCost((u.promptTokenCount||0)*PRICE.textIn+((u.candidatesTokenCount||0)+(u.thoughtsTokenCount||0))*PRICE.textOut);
  const parts=(j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts)||[];
  return parseJson(parts.filter(p=>!p.thought).map(p=>p.text||'').join(''));}
function b64bytes(b){const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
async function decodeAudio(b64,mime){
  const u=b64bytes(b64),c=AU.ctx,wav=u[0]===82&&u[1]===73&&u[2]===70&&u[3]===70;
  if(wav){try{return await c.decodeAudioData(u.buffer.slice(0));}catch(e){}}
  const rate=+((/rate=(\d+)/i.exec(mime||'')||[])[1]||24000),off=wav?44:0,n=(u.length-off)>>1,buf=c.createBuffer(1,Math.max(1,n),rate),d=buf.getChannelData(0),dv=new DataView(u.buffer,off);
  for(let i=0;i<n;i++)d[i]=dv.getInt16(i*2,true)/32768;return buf;}
/* 声：まず公式の Interactions API、だめなら generateContent（AUDIO）で */
async function tts(text,emo){
  const clean=String(text||'').trim();if(!noTags(clean))return null;
  const style=STY[emo]||STY.normal;let b64=null,mime='audio/wav',first=null;
  try{const j=await api(`${API}/interactions`,{model:CFG.ttsModel,input:[{type:'user_input',content:[{type:'text',text:clean,annotations:[{type:'speech_metadata',style}]}]}],
      response_format:{type:'audio'},generation_config:{speech_config:[{voice:CFG.voice}]}});
    for(const st of (j.steps||[]))if(st&&st.type==='model_output')for(const c of (st.content||[]))if(c&&c.type==='audio'&&c.data){b64=c.data;mime=c.mime_type||c.mimeType||mime;}
    if(!b64&&j.output_audio&&j.output_audio.data){b64=j.output_audio.data;mime=j.output_audio.mime_type||mime;}}
  catch(e){first=e;if(e.status===401||e.status===403||e.status===402)throw e;}
  if(!b64){try{const j=await api(`${API}/models/${encodeURIComponent(CFG.ttsModel)}:generateContent`,{contents:[{parts:[{text:`Say it in a ${style} tone: ${noTags(clean)}`}]}],
        generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:CFG.voice}}}}});
      const p=((j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts)||[]).find(p=>p.inlineData);
      if(p){b64=p.inlineData.data;mime=p.inlineData.mimeType||'audio/L16;rate=24000';}}
    catch(e){throw first||e;}}
  if(!b64)throw first||new Error('音声が返ってきませんでした');
  const buf=await decodeAudio(b64,mime);addCost(buf.duration*25*PRICE.ttsOut()+clean.length*PRICE.ttsIn);return buf;}

/* ---------- 音（声・効果音）と録音先 ---------- */
let AX=null;
function setupAudio(){ensureAudio();const c=AU.ctx;if(!c)throw new Error('音を初期化できませんでした');if(AX)return AX;
  const dest=c.createMediaStreamDestination(),voice=c.createGain(),se=c.createGain();voice.gain.value=1.15;se.gain.value=.55;
  [voice,se].forEach(g=>{g.connect(c.destination);g.connect(dest);});AU.master.connect(dest);
  const nb=c.createBuffer(1,c.sampleRate*2,c.sampleRate),nd=nb.getChannelData(0);for(let i=0;i<nd.length;i++)nd[i]=Math.random()*2-1;
  return AX={dest,voice,se,noise:nb};}
function duck(on){try{if(!AU.bgm)return;const t=AU.ctx.currentTime;AU.bgm.gain.cancelScheduledValues(t);AU.bgm.gain.setTargetAtTime(BGM_VOL[AU.on.bv||2]*(on?.3:1),t,.12);}catch(e){}}
function playBuf(buf){return new Promise(res=>{if(!buf||!AX){res();return;}const s=AU.ctx.createBufferSource();s.buffer=buf;s.connect(AX.voice);duck(true);
  let done=false;const fin=()=>{if(done)return;done=true;duck(false);res();};s.onended=fin;setTimeout(fin,buf.duration*1000+800);s.start();});}
const mfq=m=>440*Math.pow(2,(m-69)/12);
function osc(type,f,t,d,g,slide){const c=AU.ctx,o=c.createOscillator(),a=c.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(slide,t+d);
  a.gain.setValueAtTime(.0001,t);a.gain.exponentialRampToValueAtTime(g,t+.008);a.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(a);a.connect(AX.se);o.start(t);o.stop(t+d+.05);}
function nz(t,d,g,f,type,to){const c=AU.ctx,s=c.createBufferSource(),fl=c.createBiquadFilter(),a=c.createGain();s.buffer=AX.noise;fl.type=type||'lowpass';fl.frequency.setValueAtTime(f,t);if(to)fl.frequency.exponentialRampToValueAtTime(to,t+d);
  a.gain.setValueAtTime(g,t);a.gain.exponentialRampToValueAtTime(.0001,t+d);s.connect(fl);fl.connect(a);a.connect(AX.se);s.start(t);s.stop(t+d+.05);}
/* 効果音はすべてその場で合成（素材ファイルなし） */
const SE={
  dodon(t){[0,.2].forEach(dt=>{osc('sine',130,t+dt,.5,.95,42);nz(t+dt,.2,.55,900,'lowpass',120);});},
  jaan(t){[0,4,7,12,16].forEach(s=>osc('sawtooth',mfq(60+s),t,1.2,.1));nz(t,.6,.25,5000,'highpass');osc('sine',65,t,.9,.6,40);},
  chiin(t){osc('sine',1568,t,1.8,.35);osc('sine',2350,t,1.3,.14);osc('sine',3136,t,.8,.06);},
  pirorin(t){[72,76,79,84,88].forEach((m,i)=>osc('triangle',mfq(m),t+i*.07,.28,.25));},
  gogogo(t){nz(t,2.4,.8,170,'lowpass',80);osc('sawtooth',46,t,2.4,.32,38);osc('sine',33,t,2.4,.5);},
  poan(t){osc('sine',560,t,.6,.42,250);osc('sine',840,t+.06,.45,.14,380);},
  gyaa(t){nz(t,.8,.85,3200,'bandpass',450);osc('sawtooth',320,t,.65,.35,60);osc('sine',85,t,1,.75,32);},
  kira(t){[88,91,96,100,103].forEach((m,i)=>osc('sine',mfq(m),t+i*.05,.55,.16));},
  boo(t){[[233,0,.32],[220,.36,.32],[207,.72,.95]].forEach(([f,dt,d],i)=>osc('square',f,t+dt,d,.11,i===2?140:null));},
  dun(t){osc('sine',92,t,1.3,.95,38);nz(t,.45,.45,800,'lowpass',90);osc('square',mfq(45),t,1.1,.07);},
  pon(t){osc('sine',880,t,.16,.32,1320);}
};
function playSE(k){if(!k||k==='none'||!SE[k]||!AX)return;try{SE[k](AU.ctx.currentTime+.02);}catch(e){}}

/* ---------- 録画（本編＋ピンチのショート用） ---------- */
const RC={canvas:null,x:null,stream:null,main:null,chunks:[],pinch:null,pchunks:[],pinchMs:0,state:'idle',recMs:0,last:0,mime:''};
function pickMime(){for(const m of ['video/mp4;codecs=avc1.4D4028,mp4a.40.2','video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1.4D4028,opus','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'])try{if(MediaRecorder.isTypeSupported(m))return m;}catch(e){}return '';}
function newRec(chunks){const o={videoBitsPerSecond:4500000,audioBitsPerSecond:128000};if(RC.mime)o.mimeType=RC.mime;const rec=new MediaRecorder(RC.stream,o);rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};return rec;}
function recStart(){RC.stream=new MediaStream([...RC.canvas.captureStream(30).getVideoTracks(),...AX.dest.stream.getAudioTracks()]);RC.mime=pickMime();
  RC.chunks=[];RC.main=newRec(RC.chunks);RC.main.start(1000);try{RC.main.pause();}catch(e){}RC.state='paused';RC.recMs=0;RC.pinch=null;RC.pinchMs=0;badge();}
function tick(){if(RC.state==='rec'){const n=performance.now(),d=n-RC.last;RC.recMs+=d;if(RC.pinch)RC.pinchMs+=d;RC.last=n;}}
function recResume(){if(RC.state!=='paused')return;try{RC.main.resume();}catch(e){}if(RC.pinch&&RC.pinch.state==='paused')try{RC.pinch.resume();}catch(e){}RC.state='rec';RC.last=performance.now();think(false);badge();}
function recPause(thinking=true){if(RC.state!=='rec'){if(thinking)think(true);return;}tick();try{RC.main.pause();}catch(e){}if(RC.pinch&&RC.pinch.state==='recording')try{RC.pinch.pause();}catch(e){}RC.state='paused';think(thinking);badge();}
function stopRec(rec,chunks){return new Promise(res=>{const mk=()=>chunks.length?new Blob(chunks,{type:(rec&&rec.mimeType)||RC.mime||'video/webm'}):null;
  if(!rec||rec.state==='inactive'){res(mk());return;}rec.onstop=()=>res(mk());try{if(rec.state==='paused')rec.resume();}catch(e){}try{rec.stop();}catch(e){res(mk());}});}
/* ピンチ（HPが半分を切った・ボス戦）になったら、ショート用の録画をもう1本回す。持ち直したら捨て、死んだら保存する */
async function pinchCheck(){if(!RC.main||RC.state==='idle'||!S)return;const ratio=S.hp/Math.max(1,S.maxHp),boss=bossAlive()||S.bossFlag,low=inGame&&!TUT&&S.hp>0&&(ratio<.5||boss);
  if(RC.pinch&&((ratio>=.75&&!boss)||RC.pinchMs>150000)){const p=RC.pinch;RC.pinch=null;await stopRec(p,[]);}
  if(low&&!RC.pinch){RC.pchunks=[];RC.pinchMs=0;RC.pinch=newRec(RC.pchunks);RC.pinch.start(1000);if(RC.state!=='rec')try{RC.pinch.pause();}catch(e){}}}
async function savePinch(){if(!RC.pinch)return;tick();const p=RC.pinch,ms=RC.pinchMs;RC.pinch=null;const b=await stopRec(p,RC.pchunks);if(b&&ms>=6000&&RUN){RUN.shorts++;addFile(b,`hiyori_ep${RUN.ep}_short${RUN.shorts}`,'ショート用');}}
const FILES=[];
function addFile(blob,base,label){const ext=/mp4/.test(blob.type)?'mp4':'webm',name=`${base}.${ext}`,url=URL.createObjectURL(blob);FILES.push({name,url,size:blob.size,label});
  try{const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();}catch(e){}}

/* ---------- 画面（録画されるキャンバス） ---------- */
const V={sub:null,telops:[],stamp:null,card:null,finger:null,choice:null,over:null,boss:0,tip:null,cut:null,end:null};
const FONT='"Hiragino Sans","Noto Sans JP","Noto Sans CJK JP","Yu Gothic",system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"';
function rr2(x,X,Y,w,h,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}
function tx(x,s,X,Y,size,col,align='left',wt=800,stroke=0,sc='rgba(0,0,0,.9)'){x.font=`${wt} ${size}px ${FONT}`;x.textAlign=align;x.textBaseline='middle';if(stroke){x.lineJoin='round';x.lineWidth=stroke;x.strokeStyle=sc;x.strokeText(s,X,Y);}x.fillStyle=col;x.fillText(s,X,Y);}
const NOHEAD='、。，．！？!?」』）)ー〜…っゃゅょァィゥェォッャュョ';
function wrap(x,text,maxW){const out=[];let line='';for(const ch of [...String(text)]){if(ch==='\n'){out.push(line);line='';continue;}const t=line+ch;
    if(x.measureText(t).width>maxW&&line&&!NOHEAD.includes(ch)){out.push(line);line=ch;}else line=t;}if(line)out.push(line);return out;}
function fit(x,s,maxW,size,wt=800){x.font=`${wt} ${size}px ${FONT}`;const w=x.measureText(s).width;return w>maxW?size*maxW/w:size;}
function bar(x,X,Y,w,h,v,max,col,label){rr2(x,X,Y,w,h,h/2);x.fillStyle='rgba(255,255,255,.1)';x.fill();const f=max>0?Math.max(0,Math.min(1,v/max)):0;
  if(f>0){x.save();rr2(x,X,Y,w,h,h/2);x.clip();x.fillStyle=col;x.fillRect(X,Y,w*f,h);x.restore();}tx(x,label,X+14,Y+h/2+1,h*.62,'#fff','left',800,4);}
const cellXY=p=>[BX+(p[1]+.5)*CELL,BY+(p[0]+.5)*CELL];
function telop(text,col,dur){V.telops.push({text:String(text).slice(0,14),col:col||'#ffe14a',t0:performance.now(),dur:dur||1700});if(V.telops.length>3)V.telops.shift();}
function drawStage(now){
  const x=RC.x;if(!x||el('recStage').classList.contains('hidden')){requestAnimationFrame(drawStage);return;}
  x.fillStyle='#120d16';x.fillRect(0,0,W,H);
  /* 上：話数・タイトル・階層・HP */
  x.fillStyle='#1d1424';x.fillRect(0,0,W,BY-12);
  const ep=RUN?RUN.ep:DC.episode+1;rr2(x,16,14,104,52,26);x.fillStyle='#ff5fa2';x.fill();tx(x,'#'+ep,68,41,32,'#fff','center',900);
  const ttl=(RUN&&RUN.title)||'ヒヨリの Dungeon Chain';tx(x,ttl,134,41,fit(x,ttl,W-134-150,30),'#ffe6f1','left',800);
  const live=S&&(inGame||V.over);
  if(live){const F=`B${floorOf()}F`;tx(x,TUT?'練習':F,W-20,41,40,'#ffd54a','right',900,8);
    const c=CLASSES[S.cls]||CLASSES.warrior;tx(x,`${c.ic} ${TUT?'チュートリアル':c.n}　Lv${S.level}　撃破${S.kills}`,20,92,27,'#e9dff0','left',700);
    bar(x,16,118,W-32,36,S.hp,S.maxHp,S.hp/Math.max(1,S.maxHp)<.3?'#e0303a':'#c8404a',`❤️ ${S.hp} / ${S.maxHp}`);
    bar(x,16,162,(W-40)/2,30,S.armor,S.maxArmor,'#2f78c8',`🛡️ ${S.armor} / ${S.maxArmor}`);
    bar(x,24+(W-40)/2,162,(W-40)/2,30,S.gold,S.goldNeed,'#b8860b',`💰 ${S.gold} / ${S.goldNeed}`);}
  /* 盤面 */
  rr2(x,BX-6,BY-6,BS+12,BS+12,18);x.fillStyle='#2a1f30';x.fill();
  if(live&&cv.width){x.drawImage(cv,BX,BY,BS,BS);}
  else{x.fillStyle='#0d0a10';x.fillRect(BX,BY,BS,BS);tx(x,'DUNGEON',W/2,BY+BS*.42,74,'#d9c7a0','center',900,10);tx(x,'CHAIN',W/2,BY+BS*.56,74,'#d9c7a0','center',900,10);}
  drawBossLines(x,now);drawFinger(x,now);drawTip(x);drawChoice(x,now);drawOver(x,now);drawTelops(x,now);drawStamp(x,now);drawCut(x,now);
  /* 盤面の下：ガイド（チュートリアル）かゲームのログ */
  const gy=BY+BS+14;
  if(TUT&&TUT.msg){rr2(x,16,gy,W-32,52,14);x.fillStyle='rgba(255,215,90,.14)';x.fill();const g='📖 '+strip(TUT.msg).replace(/\n/g,' ');tx(x,g,30,gy+27,fit(x,g,W-60,26,700),'#ffe08a','left',700);}
  else{const lg=(el('log')&&el('log').textContent)||'';if(lg)tx(x,lg,W/2,gy+26,fit(x,lg,W-40,24,600),'#cbbfd3','center',600);}
  /* 字幕 */
  const sy=gy+70,sh=H-sy-92;rr2(x,16,sy,W-32,sh,22);x.fillStyle='rgba(10,6,14,.88)';x.fill();x.lineWidth=3;x.strokeStyle='#ff5fa2';x.stroke();
  rr2(x,34,sy-20,150,42,21);x.fillStyle='#ff5fa2';x.fill();tx(x,'ヒヨリ',109,sy+1,26,'#fff','center',900);
  if(V.sub&&V.sub.text){const col=EMO_COL[V.sub.emo]||'#fff';let size=42;x.font=`900 ${size}px ${FONT}`;let lines=wrap(x,V.sub.text,W-80);
    if(lines.length>3){size=34;x.font=`900 ${size}px ${FONT}`;lines=wrap(x,V.sub.text,W-80);}lines=lines.slice(0,4);
    const lh=size*1.32,top=sy+sh/2-(lines.length-1)*lh/2+6;lines.forEach((l,i)=>tx(x,l,40,top+i*lh,size,col,'left',900,8));}
  /* 下：日和り回数・通算死亡 */
  const fy=H-46;tx(x,`😳 日和り ×${RUN?RUN.hiyori:0}`,24,fy,28,'#ffb8dc','left',800);tx(x,`💀 通算 ${CHR.deaths}`,W/2+10,fy,28,'#d8cce0','center',800);tx(x,'Dungeon Chain',W-22,fy,22,'#8f8396','right',700);
  drawCard(x,now);drawEnd(x,now);
  requestAnimationFrame(drawStage);}
function drawFinger(x,now){const f=V.finger;if(!f)return;let p;
  if(f.hold){p=cellXY(f.path[0]);const k=Math.max(0,now-f.t0)%900/900;x.beginPath();x.arc(p[0],p[1],CELL*(.2+.3*k),0,Math.PI*2);x.strokeStyle=`rgba(255,215,90,${1-k})`;x.lineWidth=6;x.stroke();}
  else{if(!f.path.length)return;const dt=Math.max(0,now-f.t0),i=Math.min(f.path.length-1,Math.floor(dt/f.per));const a=cellXY(f.path[i]),b=cellXY(f.path[Math.min(f.path.length-1,i+1)]),u=Math.min(1,(dt%f.per)/f.per);p=[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u];}
  x.font=`${CELL*.62}px ${FONT}`;x.textAlign='center';x.textBaseline='middle';x.fillText('👆',p[0]+CELL*.12,p[1]+CELL*.42);}
function drawTip(x){const t=V.tip;if(!t)return;const lines=[];x.font=`700 26px ${FONT}`;t.body.split('\n').forEach(s=>lines.push(...wrap(x,s,BS-70)));const ls=lines.slice(0,8),h=90+ls.length*36;
  rr2(x,BX+14,BY+20,BS-28,h,18);x.fillStyle='rgba(20,14,26,.94)';x.fill();x.lineWidth=3;x.strokeStyle='#ffd54a';x.stroke();
  tx(x,t.title,BX+36,BY+58,34,'#ffd54a','left',900);ls.forEach((l,i)=>tx(x,l,BX+36,BY+104+i*36,26,'#eee','left',700));}
function drawChoice(x,now){const c=V.choice;if(!c)return;x.fillStyle='rgba(0,0,0,.72)';x.fillRect(BX,BY,BS,BS);
  tx(x,c.title,W/2,BY+70,fit(x,c.title,BS-40,40,900),'#ffe08a','center',900,8);
  const n=c.opts.length,bh=Math.min(150,(BS-170)/n-16);c.opts.forEach((o,i)=>{const y=BY+130+i*(bh+16),sel=c.sel===i,pulse=sel?1+.03*Math.sin(now/90):1;
    x.save();x.translate(W/2,y+bh/2);x.scale(pulse,pulse);rr2(x,-BS/2+30,-bh/2,BS-60,bh,18);x.fillStyle=sel?'rgba(255,200,60,.3)':'rgba(255,255,255,.08)';x.fill();x.lineWidth=sel?6:2;x.strokeStyle=sel?'#ffd54a':'rgba(255,255,255,.3)';x.stroke();x.restore();
    tx(x,o.label,BX+56,y+bh*.36,fit(x,o.label,BS-110,32,900),sel?'#ffe14a':'#fff','left',900);
    tx(x,o.desc,BX+56,y+bh*.72,fit(x,o.desc,BS-110,22,600),'#cbbfd3','left',600);});}
function drawOver(x,now){const o=V.over;if(!o)return;const a=Math.min(1,(now-o.t0)/500);x.fillStyle=`rgba(40,0,6,${.75*a})`;x.fillRect(BX,BY,BS,BS);x.globalAlpha=a;
  tx(x,'💀',W/2,BY+BS*.3,120,'#fff','center',900);tx(x,'力尽きた…',W/2,BY+BS*.5,64,'#ff6b6b','center',900,10);
  tx(x,o.line,W/2,BY+BS*.64,fit(x,o.line,BS-40,32,800),'#eee','center',800,6);x.globalAlpha=1;}
function drawBossLines(x,now){if(!V.boss)return;const e=(now-V.boss)/2600;if(e>1){V.boss=0;return;}const cx=W/2,cy=BY+BS/2,R=BS*.75,a=e<.15?e/.15:1-Math.max(0,(e-.7)/.3);
  x.save();x.beginPath();x.rect(BX,BY,BS,BS);x.clip();x.fillStyle=`rgba(255,255,255,${.5*a})`;
  for(let i=0;i<64;i++){const t=i/64*Math.PI*2+Math.sin(i*7.3)*.04,w=.012+(i%3)*.006,r0=BS*(.32+.08*Math.sin(i*3.1+now/80));x.beginPath();x.moveTo(cx+Math.cos(t-w)*R,cy+Math.sin(t-w)*R);x.lineTo(cx+Math.cos(t)*r0,cy+Math.sin(t)*r0);x.lineTo(cx+Math.cos(t+w)*R,cy+Math.sin(t+w)*R);x.fill();}x.restore();}
function drawTelops(x,now){V.telops=V.telops.filter(t=>now-t.t0<t.dur);V.telops.forEach((t,i)=>{const e=(now-t.t0)/t.dur,s=e<.12?.5+e/.12*.75:e<.22?1.25-(e-.12)/.1*.25:1,a=e>.8?(1-e)/.2:1,
    sh=e<.25?(Math.random()-.5)*14:0,y=BY+BS*.42+(i-(V.telops.length-1)/2)*120;x.save();x.globalAlpha=a;x.translate(W/2+sh,y+sh);x.scale(s,s);
    const size=fit(x,t.text,BS-60,96,900);tx(x,t.text,0,0,size,'#fff','center',900,size*.34,'#000');tx(x,t.text,0,0,size,t.col,'center',900,size*.12,'#fff');tx(x,t.text,0,0,size,t.col,'center',900);x.restore();});}
function drawStamp(x,now){const s=V.stamp;if(!s)return;const e=(now-s.t0)/1900;if(e>1){V.stamp=null;return;}const k=e<.1?2.2-e/.1*1.2:1,a=e>.8?(1-e)/.2:1;
  x.save();x.globalAlpha=a;x.translate(W-190,BY+120);x.rotate(-.21);x.scale(k,k);rr2(x,-140,-56,280,112,16);x.lineWidth=9;x.strokeStyle='#e8344a';x.stroke();rr2(x,-126,-42,252,84,10);x.lineWidth=3;x.stroke();
  tx(x,'日和った',0,4,56,'#e8344a','center',900);x.restore();}
function drawCut(x,now){const c=V.cut;if(!c)return;const e=(now-c.t0)/1500;if(e>1){V.cut=null;return;}const a=e<.15?e/.15:e>.75?(1-e)/.25:1;
  x.globalAlpha=a;x.fillStyle='rgba(0,0,0,.75)';x.fillRect(BX,BY+BS/2-60,BS,120);tx(x,c.text,W/2,BY+BS/2,52,'#fff','center',900);x.globalAlpha=1;}
function drawCard(x,now){const c=V.card;if(!c)return;const e=(now-c.t0)/c.dur;if(e>1){V.card=null;return;}const a=e>.82?(1-e)/.18:1;x.globalAlpha=a;
  const g=x.createLinearGradient(0,0,0,H);g.addColorStop(0,'#2a0f2a');g.addColorStop(1,'#0b0710');x.fillStyle=g;x.fillRect(0,0,W,H);
  tx(x,'ヒヨリの',W/2,H*.3,52,'#ffb8dc','center',900,8);tx(x,'DUNGEON',W/2,H*.39,96,'#e8d7a8','center',900,12);tx(x,'CHAIN',W/2,H*.47,96,'#e8d7a8','center',900,12);
  const k=Math.min(1,e/.25);x.save();x.translate(W/2,H*.62);x.scale(.6+.4*k,.6+.4*k);rr2(x,-110,-50,220,100,50);x.fillStyle='#ff5fa2';x.fill();tx(x,`#${c.ep}`,0,2,64,'#fff','center',900);x.restore();
  tx(x,c.title,W/2,H*.72,fit(x,c.title,W-60,48,900),'#fff','center',900,10);x.globalAlpha=1;}
function drawEnd(x,now){const c=V.end;if(!c)return;const a=Math.min(1,(now-c.t0)/600);x.globalAlpha=a;x.fillStyle='rgba(8,4,12,.92)';x.fillRect(0,0,W,H);
  tx(x,c.big,W/2,H*.4,110,'#ffe08a','center',900,14);tx(x,'チャンネル登録・高評価',W/2,H*.56,44,'#fff','center',900,8);tx(x,'よろしくね！',W/2,H*.62,44,'#fff','center',900,8);
  tx(x,`😳 本日の日和り ×${RUN?RUN.hiyori:0}`,W/2,H*.74,40,'#ffb8dc','center',800,6);x.globalAlpha=1;}

/* ---------- ゲームの読み取り（候補手の計算） ---------- */
const T_NAME={sword:'⚔️',shield:'🛡️',potion:'🧪',coin:'💰'};
function letters(){const m=new Map();let i=0;for(let r=0;r<N;r++)for(let c=0;c<N;c++){const t=S.board[r][c];if(isEnemy(t))m.set(t,String.fromCharCode(97+(i++%26)));}return m;}
function enemiesOnBoard(){const o=[];for(let r=0;r<N;r++)for(let c=0;c<N;c++){const t=S.board[r][c];if(isEnemy(t))o.push([t,r,c]);}return o;}
function searchPaths(){
  const best=new Map(),G=[];for(let r=0;r<N;r++){G.push([]);for(let c=0;c<N;c++)G[r].push(groupOf(S.board[r][c].t));}
  for(let r0=0;r0<N;r0++)for(let c0=0;c0<N;c0++){const g=G[r0][c0];let budget=900;const path=[[r0,c0]],used=new Set([r0*N+c0]);
    const dfs=()=>{if(--budget<0)return;const [r,c]=path[path.length-1];
      if(path.length>=3){const sig=g+':'+[...used].sort((a,b)=>a-b).join(',');if(!best.has(sig))best.set(sig,path.slice());}
      if(path.length>=14)return;
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const R=r+dr,C=c+dc;if(R<0||C<0||R>=N||C>=N)continue;const k=R*N+C;if(used.has(k)||G[R][C]!==g)continue;
        used.add(k);path.push([R,C]);dfs();path.pop();used.delete(k);}};
    dfs();}
  return [...best.entries()].map(([sig,p])=>({sig,path:p}));}
function evalPath(o){const p=o.path,t0=tileAt(p[0]),g=groupOf(t0.t),n=p.length,mu=chainMult(n),e={sig:o.sig,path:p,g,n};
  if(g==='atk'){e.sw=p.filter(q=>tileAt(q).t==='sword').length;const en=p.filter(q=>isEnemy(tileAt(q)));e.en=en.length;e.d=chainDmg(p,S.cls==='gambler'?gRoll():1);
    const lastE=S.cls==='hunter'?lastEnemyOf(p):null;e.kills=new Set();e.kn=[];en.forEach(q=>{const t=tileAt(q);if(wouldDie(t,dmgTo(t,q===lastE?Math.round(e.d*HUNT):e.d))){e.kills.add(q[0]*N+q[1]);e.kn.push(t);}});
    e.k=e.kills.size;e.after=enemyTotal(e.kills);e.katk=e.kn.reduce((a,t)=>a+(enemyAtk(t).d||0),0);}
  else if(g==='potion'){const heal=Math.round(n*S.healPer*mu);e.v=Math.min(heal,S.maxHp-S.hp);}
  else if(g==='shield'){const a=Math.round(n*S.armorPer*mu);e.v=Math.min(a,S.maxArmor-S.armor);e.over=a-e.v;}
  else if(g==='coin'){e.v=Math.round(n*S.goldPer*mu);}
  return e;}
const nameOf=t=>{const k=kindOf(t),d=EK[k]||{};return (t.ic||d.icon||'💀')+(d.name||'敵');};
function describe(e){const H3=CFG.heta;
  if(e.g==='atk'){let s=`⚔️攻撃 ${e.n}つ（剣${e.sw}・敵${e.en}）→ 敵${e.en}体に${e.d}ダメージ`;if(H3<=2)s+=e.k?`、撃破${e.k}（${e.kn.map(nameOf).join('・')}）`:'、撃破なし';if(H3<=1)s+=` ／ 次の敵の攻撃 ${e.after}`;return s+(e.n>=7?' ★大連鎖':'');}
  if(e.g==='potion')return `🧪回復 ${e.n}つ → HP+${e.v}（今 ${S.hp}/${S.maxHp}）`+(e.n>=7?' ★大連鎖':'');
  if(e.g==='shield')return `🛡️防御 ${e.n}つ → 防御+${e.v}（今 ${S.armor}/${S.maxArmor}）`+(e.over?`・あふれた${e.over}は盾ptへ`:'')+(e.n>=7?' ★大連鎖':'');
  if(e.g==='coin')return `💰お金 ${e.n}つ → +${e.v}（ショップまで あと${Math.max(0,S.goldNeed-S.gold)}）`+(e.n>=7?' ★大連鎖':'');
  return `⚗️調合 ${e.n}つ`;}
function snipeBest(){const u=SKD.snipe();let best=null;for(let r=0;r<N;r++)for(let c=0;c<N;c++){let h=0,k=0;aimCells([r,c]).forEach(([R,C,m])=>{const t=S.board[R][C];if(isEnemy(t)){h++;if(wouldDie(t,dmgTo(t,u*m)))k++;}});
    if(h&&(!best||k*10+h>best.k*10+best.h))best={c:[r,c],h,k};}return best;}
function analyze(){
  const info={cands:[],maxLen:0,maxKills:0,newKinds:[],lt:letters()};
  enemiesOnBoard().forEach(([t])=>{const k=kindOf(t);if(!DC.seen[k]&&!info.newKinds.includes(k))info.newKinds.push(k);});
  if(TUT){const st=TSTEPS[TUT.i];
    if(st.wait==='tip')info.cands.push({id:'A',type:'inspect',p:st.path[0],desc:'光っている💀を長押しして説明を見る'});
    else if(st.wait==='skill')info.cands.push({id:'A',type:'skill',i:0,desc:'下のスキルをタップして使う'});
    else if(TUT.path)info.cands.push({id:'A',type:'chain',path:TUT.path.map(p=>[p[0],p[1]]),desc:'ガイドが光らせているところをなぞる'});
    return info;}
  const ev=searchPaths().map(evalPath),pick=[],has=s=>pick.some(e=>e.sig===s.sig),add=e=>{if(e&&!has(e)&&pick.length<7)pick.push(e);};
  info.maxAtkLen=0;ev.forEach(e=>{info.maxLen=Math.max(info.maxLen,e.n);if(e.g==='atk'){info.maxKills=Math.max(info.maxKills,e.k);if(e.en)info.maxAtkLen=Math.max(info.maxAtkLen,e.n);}});
  const atk=ev.filter(e=>e.g==='atk'&&e.en>0);
  add(atk.slice().sort((a,b)=>b.k-a.k||b.katk-a.katk||b.en-a.en||b.n-a.n)[0]);
  add(atk.slice().sort((a,b)=>b.n-a.n||b.k-a.k)[0]);
  add(atk.filter(e=>e.n===3&&e.k>0).sort((a,b)=>b.katk-a.katk)[0]);
  if(!atk.length)add(ev.filter(e=>e.g==='atk').sort((a,b)=>b.n-a.n)[0]);
  ['potion','shield','coin','mix'].forEach(g=>add(ev.filter(e=>e.g===g).sort((a,b)=>b.n-a.n)[0]));
  pick.forEach((e,i)=>info.cands.push({id:String.fromCharCode(65+i),type:'chain',path:e.path,e,desc:describe(e)}));
  if(!(RUN&&RUN.skTurn===S.turn&&RUN.skN>=2))S.skills.forEach((s,i)=>{if(s.cur>0)return;const d=SKILLS[s.id];let x='';if(s.id==='snipe'){const b=snipeBest();if(!b)return;x=`（敵${b.h}体に命中${CFG.heta<=2?`・撃破${b.k}`:''}）`;info.cands.push({id:'S'+(i+1),type:'skill',i,at:b.c,desc:`スキル${d.icon}${d.name}：${strip(skillDesc(s.id))}${x}（ターンを使わない）`});return;}
    info.cands.push({id:'S'+(i+1),type:'skill',i,desc:`スキル${d.icon}${d.name}：${strip(skillDesc(s.id))}（ターンを使わない）`});});
  if(RUN&&!RUN.inspected){let n=0;enemiesOnBoard().forEach(([t,r,c])=>{const k=kindOf(t);if(n<2&&!DC.known[k]&&!info.cands.some(x=>x.type==='inspect'&&x.k===k)){n++;info.cands.push({id:'I'+n,type:'inspect',p:[r,c],k,desc:`${nameOf(t)}を長押しして説明を読む（ターンを使わない）`});}});}
  return info;}
function bestHeuristic(info){let best=null,bs=-Infinity;const hr=S.hp/Math.max(1,S.maxHp),inc=enemyTotal();
  info.cands.forEach(c=>{let s=0;if(c.type==='chain'&&c.e){const e=c.e;
      if(e.g==='atk')s=e.k*12+e.en*3+e.n+e.katk;else if(e.g==='potion')s=hr<.45?30+e.n+e.v/4:e.n*.4;else if(e.g==='shield')s=(S.armor<S.maxArmor/2&&inc>S.armor)?14+e.n:e.n*.4;else s=e.n*.6;}
    else if(c.type==='chain')s=c.path.length;else if(c.type==='skill'){const id=S.skills[c.i]&&S.skills[c.i].id;s=id==='heal'?(hr<.3?40:-1):id==='wall'?(S.armor<2&&inc>4?20:-1):3;}else s=-5;
    if(s>bs){bs=s;best=c;}});return best;}

/* ---------- AIへの指示 ---------- */
const HETA=['','初心者だが、画面に出る予測（撃破数や敵の攻撃）はちゃんと見て考える。','初心者。派手で長いチェーンが大好きで、HP管理が雑。予測はたまにしか見ない。','かなり下手。予測はほとんど見ず、見た目の派手さと勢いで選ぶ。HPが減ってから慌てる。'];
function sysPrompt(){return `あなたはゲーム実況者「ヒヨリ」です。スマホのパズルRPG「Dungeon Chain」を、自分で操作しながら実況します。
# ヒヨリの設定
- 社会人2年目の事務職。一人暮らし。平日の夜と週末にゲーム実況をしている。一人称は「あたし」。
- 好き：コンビニスイーツの新作チェック、辛いもの、夜ふかし、猫（飼いたいけど飼えない）。苦手：朝、虫、説明を最後まで読むこと。
- 性格：負けず嫌い。すぐ調子に乗る。失敗は引きずらない。うまくいくと子どもみたいに全力で喜ぶ。魔物に勝手にあだ名をつける。
- 普段は派手な大連鎖が好きで無謀なのに、肝心なところで安全策を選んでしまう（＝日和る）。日和ったときは「…あ、ちょっと日和っちゃいました」のようなことを言う（毎回同じ言い方にしない）。
- 口調：「〜じゃん」「えぐ」「ちょ待って」「無理無理無理」「は？」など今どきの話し方。口は少し悪いが、毒づく相手は「自分・魔物・運」だけ。視聴者には優しい。悪態のあとに本音が出る（例「クソゲー！…いや好きだけど」）。
- ゲームの腕前：${HETA[CFG.heta]||HETA[2]}
- このゲームは初見。攻略情報は知らない。知っているのは「気づきメモ」に自分で書いたことと、長押しで読んだ説明だけ。
# 絶対に言わないこと
差別、下ネタ、政治・宗教・時事ニュース、実在の人物や他の実況者の話、視聴者への悪口、強い放送禁止用語。
# 話し方のルール
- 字幕になるので、自然な話し言葉。数字の羅列や説明口調にしない。
- 同じ言い回しを繰り返さない（直近のセリフを参照）。
- 笑い・ため息・息をのむ音は、英語のタグ <laugh> <sigh> <gasp> <short pause> をセリフ中に入れてよい（1つのセリフに1個まで）。
- 指定された文字数の上限を必ず守る。
- 出力はJSONだけ。`;}
function dateLine(){const d=new Date(),m=d.getMonth()+1,s=m<=2||m===12?'冬':m<=5?'春':m<=8?'夏':'秋';return `今日は${m}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）、${d.getHours()}時台。季節は${s}。`;}
function statusText(){const c=CLASSES[S.cls]||CLASSES.warrior,inc=enemyTotal();
  return `職業：${c.ic}${c.n}／Lv${S.level}（経験 ${S.xp}/${S.xpNeed}）／${TUT?'チュートリアル':`B${floorOf()}F`}・${S.turn}ターン目
HP ${S.hp}/${S.maxHp}／防御 ${S.armor}/${S.maxArmor}／お金 ${S.gold}（ショップまで あと${Math.max(0,S.goldNeed-S.gold)}）`+
  (CFG.heta<=2?`\n次のターンの敵の攻撃：合計${inc}（防御で${Math.min(S.armor,inc)}まで受け止める）`:'')+
  (S.skills.length?`\nスキル：${S.skills.map(s=>`${SKILLS[s.id].icon}${SKILLS[s.id].name}${s.cur>0?`（あと${s.cur}ターン）`:'（使える）'}`).join(' ')}`:'');}
function boardText(lt){return S.board.map(row=>row.map(t=>isEnemy(t)?(lt.get(t)||'?'):T_NAME[t.t]||'・').join(' ')).join('\n');}
function enemyText(lt,info){const es=enemiesOnBoard();if(!es.length)return '（いない）';
  return es.map(([t])=>{const k=kindOf(t),d=EK[k]||{},bits=[`${lt.get(t)}: ${nameOf(t)} HP${Math.max(0,t.hp)}/${t.maxHp} 攻撃${t.atk} 装甲${t.armor}`];
    if(t.boss)bits.push('【ボス】');if(info.newKinds.includes(k))bits.push('【初めて見る】');if(t.fresh)bits.push('（出たばかり）');if(t.frz>0)bits.push('（凍って動けない）');
    if(DC.known[k]&&d.desc)bits.push('説明：'+d.desc.replace(/\s/g,''));return bits.join(' ');}).join('\n');}
const recentLines=()=>RUN&&RUN.lines.length?RUN.lines.slice(-8).map(s=>'・'+s).join('\n'):'（まだない）';
const notesText=()=>DC.notes.length?DC.notes.slice(-25).map(s=>'・'+s).join('\n'):'（まだない）';
const MODE_I={
  tutorial:'チュートリアル中。ガイドの文をちゃんと読まずに雑に反応しつつ、ガイドの通りの手（A）を選ぶ。reactionとtalkを合わせて40文字以内。',
  highlight:'見せ場。どの手にするか迷っていることも声に出して、考えながらしゃべる。reactionとtalkを合わせて60文字以内。',
  routine:'普段の手。ほぼ一言だけ（reactionとtalkを合わせて15文字以内）。両方空（無言）でもよい。',
  smalltalk:'盤面は落ち着いている。手を選びつつ、短い世間話をはさむ（reactionとtalkを合わせて70文字以内）。今日の日付や季節、曜日にちなんだ日常の話題で、「使った話題」とかぶらないもの。時事ニュースや実在の人物の話は禁止。'};
const MAXL={tutorial:40,highlight:60,routine:15,smalltalk:70};
function turnPrompt(info,mode){const lt=info.lt;
  return `# いまの状況
第${RUN.ep}話・動画の経過 ${fmtT(RC.recMs)}／目標 ${CFG.minutes}分
${dateLine()}
${TUT?`ガイドの表示：「${strip(TUT.msg).replace(/\n/g,' ')}」\n`:''}# ステータス
${statusText()}
# 盤面（6×6。⚔️剣 🛡️盾 🧪薬 💰お金、a〜は敵）
${boardText(lt)}
# 敵
${enemyText(lt,info)}
# 前のターンの結果
${RUN.lastResult||'（このプレイの最初のターン）'}
# 選べる手
${info.cands.map(c=>`${c.id}: ${c.desc}`).join('\n')}
# 気づきメモ（自分で学んだこと）
${notesText()}
# 使った世間話の話題
${CHR.topics.slice(-15).join('、')||'（まだない）'}
# 直近のセリフ（同じ言い回しはしない）
${recentLines()}
# 指示
${MODE_I[mode]}
次のJSONだけを返す：
{"reaction":"前のターンの結果への一言（不要なら空）","talk":"次の一手を考えるトーク","choice":"選ぶ手のID","hiyotta":安全策に逃げたならtrue,"emotion":"${EMOS.join('|')}","se":"${SES.join('|')}","telop":"画面に大きく出す文字（8文字以内。見せ場だけ。普段は空）","note":"新しく気づいた攻略メモ1行（なければ空）","smalltalk":"世間話をしたときだけ、その話題を短く"}`;}
function modalPrompt(title,opts){return `# いまの状況
第${RUN.ep}話。${statusText()}
# 画面：${title}
${opts.map((o,i)=>`${i+1}: ${o.label}（${o.desc}）`).join('\n')}
# 気づきメモ
${notesText()}
# 直近のセリフ
${recentLines()}
どれか1つを選ぶ。選びながらの一言（30文字以内）。次のJSONだけを返す：
{"talk":"一言","choice":番号,"emotion":"${EMOS.join('|')}","se":"${SES.join('|')}","telop":"8文字以内か空"}`;}
async function eventLines(scene,maxLines,maxChars){
  const user=`# 場面
${scene}
# 今日
${dateLine()}
# 気づきメモ
${notesText()}
# 使った世間話の話題
${CHR.topics.slice(-15).join('、')||'（まだない）'}
# 直近のセリフ
${recentLines()}
次のJSONだけを返す（linesは${maxLines}個まで、1つ${maxChars}文字以内）：
{"title":"動画の副題（15文字以内。オープニングのときだけ）","lines":[{"text":"セリフ","emotion":"${EMOS.join('|')}","se":"${SES.join('|')}","telop":"8文字以内か空"}],"note":"学んだ攻略メモ1行（なければ空）","smalltalk":"世間話をしたときだけ話題を短く"}`;
  const r=await llm(sysPrompt(),user);if(!r||!Array.isArray(r.lines))return null;r.lines=r.lines.filter(l=>l&&l.text).slice(0,maxLines);return r;}
function addNote(n){n=noTags(n).slice(0,60);if(!n||DC.notes.includes(n))return;DC.notes.push(n);if(DC.notes.length>40)DC.notes=DC.notes.slice(-40);saveData();}
function addTopic(t){t=noTags(t).slice(0,20);if(!t)return;CHR.topics.push(t);if(CHR.topics.length>60)CHR.topics=CHR.topics.slice(-60);saveData();}
function remember(text){const s=noTags(text);if(s&&RUN){RUN.lines.push(s.slice(0,70));if(RUN.lines.length>30)RUN.lines.shift();}}

/* ---------- 進行 ---------- */
let RUN=null;
async function ai(fn){for(;;){try{return await fn();}catch(e){if(RUN&&RUN.stopReq)throw e;const a=await askError(e);if(a==='stop'){RUN.stopReq='error';throw e;}}}}
async function waitIdle(max=20000){const t0=performance.now();await sleep(60);
  while(performance.now()-t0<max){if(RUN&&RUN.stopReq)return;if(!S||!inGame||modalOpen)return;if(!dying&&!busy()&&popLeft()<=0&&!(TUT&&TUT.lock))return;await sleep(80);}}
function showSub(text,emo){const t=noTags(text);V.sub=t?{text:t,emo:emo||'normal',t0:performance.now()}:null;}
async function say(text,emo,buf,se,tel){if(se)playSE(se);if(tel)telop(tel);showSub(text,emo);remember(text);await playBuf(buf);if(!buf&&noTags(text))await sleep(Math.min(3500,600+noTags(text).length*90));}
/* セリフを何行かまとめて：録画を止めて声を全部作ってから、続けて流す */
async function speakLines(lines){if(!lines||!lines.length)return;recPause();
  const bufs=await ai(()=>Promise.all(lines.map(l=>tts(l.text,EMOS.includes(l.emotion)?l.emotion:'normal'))));
  recResume();for(let i=0;i<lines.length;i++){const l=lines[i];await say(l.text,l.emotion,bufs[i],l.se,l.telop);await sleep(250);}}
async function doChain(path,fast){const per=fast?70:120;chain=[];V.finger={path,t0:performance.now(),per};
  for(let i=0;i<path.length;i++){chain.push([path[i][0],path[i][1]]);sfx('link',chain.length);updatePreview();await sleep(i?per:per+60);}
  await sleep(fast?80:220);V.finger=null;
  if(tutRejectChain()){chain=[];updatePreview();return false;}
  if(chain.length>=3){commitChain();if(RUN)RUN.log=(el('log')&&el('log').textContent)||'';return true;}chain=[];return false;}
async function inspect(p){V.finger={path:[p],t0:performance.now(),hold:true};await sleep(700);const t=tileAt(p),html=tileInfo(p),lines=strip(html).split('\n').filter(Boolean);
  V.tip={title:lines[0]||'説明',body:lines.slice(1).join('\n')};sfx('link',3);if(isEnemy(t)){DC.known[kindOf(t)]=1;saveData();}
  await sleep(2600);V.tip=null;V.finger=null;if(RUN)RUN.inspected=isEnemy(t)?`${nameOf(t)}の説明を読んだ：${(EK[kindOf(t)]||{}).desc||''}`:'';
  if(TUT&&TSTEPS[TUT.i].wait==='tip'){TUT.tipSeen=true;tutDone();}}
async function useSk(c){const sk=S.skills[c.i];if(!sk)return;if(RUN){if(RUN.skTurn!==S.turn){RUN.skTurn=S.turn;RUN.skN=0;}RUN.skN++;}if(sk.id==='snipe'){useSkill(c.i);await sleep(500);if(AIM){AIM.c=c.at;updatePreview();await sleep(700);useSkill(c.i,c.at);}}else useSkill(c.i);}
async function execute(c,fast){if(!c)return;if(c.type==='chain')await doChain(c.path,fast);else if(c.type==='skill')await useSk(c);else if(c.type==='inspect')await inspect(c.p);}
const snap=()=>({hp:S.hp,maxHp:S.maxHp,armor:S.armor,floor:floorOf(),level:S.level,kills:S.kills,boss:bossAlive(),rid:S.rid,ach:RUN?RUN.achN:0});
function resultText(b){const a=snap(),ev=[];if(RUN.log)ev.push(RUN.log);
  if(a.hp!==b.hp)ev.push(`HP ${b.hp}→${a.hp}/${a.maxHp}`);if(a.armor!==b.armor)ev.push(`防御 ${b.armor}→${a.armor}`);
  if(a.level>b.level)ev.push(`レベルアップ（Lv${a.level}）`);if(a.floor>b.floor)ev.push(`B${a.floor}Fに進んだ`);
  if(!b.boss&&a.boss)ev.push('ボスが現れた！');if(b.boss&&!a.boss&&a.hp>0)ev.push('ボスを倒した！');
  if(RUN.inspected){ev.push(RUN.inspected);RUN.inspected='';}
  if(RUN.achNames.length){ev.push('実績「'+RUN.achNames.join('」「')+'」を解除');RUN.achNames=[];}
  return ev.join('／');}
function autoFx(b,c){const a=snap(),n=c&&c.type==='chain'?c.path.length:0,kd=a.kills-b.kills;
  if(!b.boss&&a.boss){V.boss=performance.now();playSE('gogogo');telop('ボス戦','#ff5a5a',2200);}
  else if(b.boss&&!a.boss&&a.hp>0){playSE('dodon');telop('討伐!!','#ffd54a',2200);}
  else if(n>=8){playSE('jaan');telop(`${n}連鎖!!`,'#ffe14a');}
  else if(kd>=3){playSE('dodon');telop(`${kd}体撃破!`,'#ff9a3a');}
  if(a.hp>0&&a.hp/a.maxHp<.2&&b.hp/b.maxHp>=.2)playSE('dun');
  while(RUN.achQ.length){const x=RUN.achQ.shift();setTimeout(()=>{playSE('kira');telop('🏆実績解除','#7fe0ff',1800);},400);RUN.achNames.push(x.n);}}
function highlight(info){const hr=S.hp/Math.max(1,S.maxHp);return RUN.runTurn<2||bossAlive()||S.bossFlag||hr<.35||info.newKinds.length>0||info.maxKills>=4||info.maxAtkLen>=11||RUN.justLeveled||RUN.floorUp;}
function pickMode(info){if(TUT)return 'tutorial';const hi=highlight(info),el2=RC.recMs,T=targetMs();
  if(!hi&&RUN.cutOK&&((el2>T*.72&&RUN.routine>=1)||(el2>T*.4&&RUN.routine>=10)))return 'digest';
  if(hi)return 'highlight';
  if(RUN.sinceTalk>=12&&S.hp/S.maxHp>=.6&&el2<T-90000&&Math.random()<.5)return 'smalltalk';
  return 'routine';}
async function turn(){
  const info=analyze();if(!info.cands.length){await sleep(300);return;}
  const mode=pickMode(info);
  if(mode==='digest'){await digest();return;}
  const b=snap();recPause();
  let r=null;try{r=await ai(()=>llm(sysPrompt(),turnPrompt(info,mode)));}catch(e){return;}
  info.newKinds.forEach(k=>DC.seen[k]=1);
  const id=r&&String(r.choice==null?'':r.choice).trim().toUpperCase(),c=info.cands.find(x=>x.id===id)||bestHeuristic(info);
  const emo=r&&EMOS.includes(r.emotion)?r.emotion:'normal';
  let text=r?[r.reaction,r.talk].map(s=>String(s||'').trim()).filter(Boolean).join(' '):'';if(noTags(text).length>(MAXL[mode]||60)*1.6)text=noTags(text).slice(0,Math.round((MAXL[mode]||60)*1.6));
  let buf=null;if(noTags(text)){try{buf=await ai(()=>tts(text,r&&r.hiyotta?'hiyori':emo));}catch(e){return;}}
  if(r&&r.note)addNote(r.note);if(r&&r.smalltalk){addTopic(r.smalltalk);RUN.sinceTalk=0;}
  recResume();
  if(r&&r.hiyotta&&!TUT){RUN.hiyori++;CHR.hiyori++;saveData();V.stamp={t0:performance.now()};playSE('poan');}
  await say(text,emo,buf,r&&SES.includes(r.se)?r.se:null,r&&r.telop?noTags(r.telop).slice(0,8):null);
  RUN.justLeveled=false;RUN.floorUp=false;RUN.log='';
  await execute(c);await waitIdle();
  RUN.runTurn++;RUN.sinceTalk++;if(mode==='routine'||mode==='smalltalk')RUN.routine++;else RUN.routine=0;
  const a=snap();if(a.floor>b.floor)RUN.floorUp=true;
  RUN.lastResult=resultText(b);autoFx(b,c);await pinchCheck();}
/* 早送り：録画を止めたまま、ふつうの手を数ターン自動で進める（ジャンプカット） */
async function digest(){let k=0;recPause(false);
  while(k<8&&!RUN.stopReq){if(!inGame||modalOpen||dying||(S&&S.hp<=0))break;const info=analyze();if(k>0&&highlight(info))break;
    const b=snap();await execute(bestHeuristic(info),true);await waitIdle();k++;RUN.runTurn++;autoFx(b,null);V.telops=[];}
  RUN.routine=0;RUN.lastResult=`（早送りで${k}ターン進んだ。いまHP${S.hp}/${S.maxHp}・B${floorOf()}F）`;
  recResume();if(k){V.cut={text:`〜 ${k}ターン後 〜`,t0:performance.now()};playSE('pon');await sleep(1400);}}
async function onModal(){const mb=el('mbox');
  if(el('te1')){recPause();let r=null;try{r=await eventLines('チュートリアルが終わった。いよいよ本番の冒険に出る。ひとことだけ。',1,35);}catch(e){}
    if(r){try{await speakLines(r.lines);}catch(e){recResume();}}else recResume();el('te1').click();await sleep(1500);RUN.runTurn=0;if(S)RUN.runs.push({cls:S.cls,start:1});return;}
  if(el('pcGo')){el('pcGo').click();await sleep(800);return;}
  if(el('g1'))return;
  const btns=[...mb.querySelectorAll('button.opt')].filter(b=>!b.disabled&&b.id!=='rpBack');
  if(!btns.length){await sleep(600);if(modalOpen&&!el('g1'))closeModal();return;}
  if(btns.length===1){await sleep(900);btns[0].click();await sleep(600);return;}
  const title=mb.classList.contains('m-lv')?'🎉 レベルアップ！':mb.classList.contains('m-shop')?'💰 ショップ':mb.classList.contains('m-smith')?'🛡️ 防具の強化':((mb.querySelector('h2')||{}).textContent||'どれにする？');
  const opts=btns.map(b=>{const sm=b.querySelector('small'),desc=sm?sm.textContent.trim():'';return {label:b.textContent.replace(desc,'').trim(),desc};});
  V.choice={title,opts,sel:-1};recPause();
  let r=null;try{r=await ai(()=>llm(sysPrompt(),modalPrompt(title,opts)));}catch(e){V.choice=null;return;}
  let idx=Math.round(+(r&&r.choice))-1;if(!(idx>=0&&idx<btns.length))idx=0;
  const emo=r&&EMOS.includes(r.emotion)?r.emotion:'excited',text=r?String(r.talk||''):'';
  let buf=null;if(noTags(text)){try{buf=await ai(()=>tts(text,emo));}catch(e){return;}}
  recResume();await say(text,emo,buf,r&&SES.includes(r.se)?r.se:'pirorin',r&&r.telop?noTags(r.telop).slice(0,8):null);
  V.choice.sel=idx;playSE('pon');await sleep(1000);btns[idx].click();await sleep(700);V.choice=null;RUN.justLeveled=true;
  RUN.lastResult=(RUN.lastResult?RUN.lastResult+'／':'')+`${title.replace(/^\S+\s/,'')}で「${opts[idx].label}」を選んだ`;}
function nextClass(){const n=DC.newCls;DC.newCls=null;saveData();if(n&&classOk(n))return n;return partyCls();}
function startRun(cls){closeModal();V.over=null;newAdventure(cls);RUN.runTurn=0;RUN.routine=0;RUN.lastResult='';RUN.runs.push({cls,start:floorOf()});}
async function onDeath(){
  const F=floorOf(),k=S._topK&&EK[S._topK]?EK[S._topK]:null,killer=k?k.icon+k.name:'敵の攻撃',cls=(CLASSES[S.cls]||CLASSES.warrior).n,newC=S._newCls||null;
  CHR.deaths++;DC.midRun=false;if(newC&&newC.length)DC.newCls=newC[newC.length-1];
  const cur=RUN.runs[RUN.runs.length-1]||{};Object.assign(cur,{floor:F,turn:S.turn,lv:S.level,ch:S.maxChain||0,killer,cls});
  DC.history.push({ep:RUN.ep,d:Date.now(),cls,floor:F,killer,turn:S.turn,lv:S.level});if(DC.history.length>100)DC.history=DC.history.slice(-100);saveData();
  const cont=RC.recMs<targetMs()-150000&&!RUN.stopReq;
  V.over={t0:performance.now(),line:`B${F}F・${killer}にやられた`};recPause();
  const scene=`死亡した。B${F}F（${placeOf(F)}）で ${killer} にやられた。職業は${cls}。今回のプレイ：${S.turn}ターン、Lv${S.level}、最長${S.maxChain||0}チェーン。通算${CHR.deaths}回目の死亡。
1行目：絶叫（emotionはscream）。
2行目：一拍おいて急に冷静に「…はい。死にました。」（このお約束は必ず入れる。言い回しは少しなら変えてよい。emotionはcalm）。
3行目：敗因を一言で振り返る。
${cont?`4行目：もう1回挑戦する宣言。${newC?`新しく「${newC.map(x=>CLASSES[x].n).join('・')}」が仲間になったので、次はそれを使うことに触れる。`:''}`:''}
noteに、敗因から学んだ攻略メモを1行。`;
  let r=null;try{r=await ai(()=>eventLines(scene,cont?4:3,40));}catch(e){}
  if(!r)r={lines:[{text:'ぎゃー！！',emotion:'scream'},{text:'…はい。死にました。',emotion:'calm'}]};
  if(r.note)addNote(r.note);
  if(r.lines[0]){r.lines[0].se='gyaa';r.lines[0].telop=r.lines[0].telop||'死亡';}
  try{await speakLines(r.lines);}catch(e){}
  await savePinch();await sleep(500);
  if(cont)startRun(nextClass());else RUN.stopReq=RUN.stopReq||'death';}
async function opening(){
  const cont=RUN.cont,last=DC.history[DC.history.length-1];
  const scene=RUN.ep===1&&!cont?`第1話のオープニング。初めての動画。お約束のあいさつ「はいどーも、ヒヨリでーす」で始める。→軽い自己紹介（仕事終わりにゲームしてる）→今日やるゲームは「Dungeon Chain」で初見→説明は読まない宣言→今日の日付や季節にちなんだ軽い世間話→「いくよー」的な一言。titleは今回の副題（例：説明読まずに地下へ）。`
    :cont?`第${RUN.ep}話のオープニング。前回の冒険の続きから（${slotLine0()}）。あいさつ「はいどーも、ヒヨリでーす」で始め、前回までのあらすじを一言、今日の目標、軽い世間話、意気込み。titleは今回の副題。`
    :`第${RUN.ep}話のオープニング。あいさつ「はいどーも、ヒヨリでーす」で始める。${last?`前回は B${last.floor}F で ${last.killer} にやられた（職業：${last.cls}）。`:''}新しい冒険に出る（職業：${(CLASSES[S.cls]||CLASSES.warrior).n}）。前回の反省や今日の目標、軽い世間話、意気込み。titleは今回の副題。`;
  let r=null;try{r=await ai(()=>eventLines(scene,4,45));}catch(e){}
  if(!r)r={title:'',lines:[{text:'はいどーも、ヒヨリでーす！今日もやってくよ〜',emotion:'excited'}]};
  RUN.title=noTags(r.title||'').slice(0,18)||(RUN.ep===1?'説明読まずに地下へ':`第${RUN.ep}話`);if(r.smalltalk)addTopic(r.smalltalk);
  const bufs=await ai(()=>Promise.all(r.lines.map(l=>tts(l.text,EMOS.includes(l.emotion)?l.emotion:'normal'))));
  recResume();V.card={ep:RUN.ep,title:RUN.title,t0:performance.now(),dur:3000};playSE('jaan');await sleep(3000);
  for(let i=0;i<r.lines.length;i++){const l=r.lines[i];await say(l.text,l.emotion,bufs[i],l.se,l.telop);await sleep(250);}}
function slotLine0(){const s=slotInfo(SLOT);return s&&!s.broken?`B${s.floor||1}F・Lv${s.level}・${(CLASSES[s.cls]||CLASSES.warrior).n}`:'';}
async function ending(){
  const alive=inGame&&S&&S.hp>0&&!TUT;if(alive)DC.midRun=true;saveData();
  const runs=RUN.runs.filter(x=>x.floor).map(x=>`${x.cls}でB${x.floor}F（${x.killer}にやられた）`).join('、')||'まだ死んでいない';
  const scene=`エンディング。今日の結果：${runs}。${alive?`いまの冒険は B${floorOf()}F で生きたまま、続きは次回に持ち越し（「続きは次回！」と言う）。`:''}本日の日和り回数は${RUN.hiyori}回（発表してツッコむ）。次回への意気込み。最後はお約束「チャンネル登録と高評価よろしく〜！じゃね！」系で締める。`;
  recPause();let r=null;try{r=await eventLines(scene,4,45);}catch(e){}
  if(!r)r={lines:[{text:`今日の日和りは${RUN.hiyori}回！次はもっと深く行くから。チャンネル登録よろしく、じゃね！`,emotion:'excited'}]};
  try{await speakLines(r.lines);}catch(e){recResume();}
  V.end={big:alive?'つづく':'おしまい',t0:performance.now()};playSE('chiin');await sleep(3200);}
async function runEpisode(){
  const btn=el('rpGo');if(btn)btn.disabled=true;
  try{setupAudio();}catch(e){alert(e.message);if(btn)btn.disabled=false;return;}
  if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){alert('このブラウザでは録画できません（AndroidのChromeで開いてください）');if(btn)btn.disabled=false;return;}
  takeSnapshot();
  RUN={ep:DC.episode+1,title:'',hiyori:0,runs:[],lines:[],lastResult:'',runTurn:0,routine:0,sinceTalk:6,stopReq:null,justLeveled:false,floorUp:false,log:'',inspected:'',achQ:[],achNames:[],achN:0,cost:0,shorts:0,cutOK:true,cont:false};
  V.sub=null;V.over=null;V.end=null;V.telops=[];
  showStage(true);wake();
  /* ゲームを用意：初回はチュートリアル、前回の続き、または新しい冒険 */
  if(DC.midRun&&slotJson(SLOT)){RUN.cont=true;loadSlot(SLOT);RUN.runs.push({cls:S.cls,start:floorOf()});}
  else if(!tutDoneFlag()){DC.midRun=false;startTutorial(true);}
  else{DC.midRun=false;startRun(nextClass());}
  await sleep(400);recStart();
  try{
    await opening();
    while(!RUN.stopReq){
      if(!inGame&&el('g1')){await onDeath();continue;}
      if(modalOpen){await onModal();continue;}
      if(!inGame||!S){await sleep(200);continue;}
      if(dying||busy()||popLeft()>0||(TUT&&TUT.lock)){await sleep(100);continue;}
      if(!TUT&&RC.recMs>=targetMs()-50000){RUN.stopReq='time';break;}
      await turn();}
  }catch(e){console.error(e);}
  await finish();}
async function finish(){
  const quick=RUN.stopReq==='now'||RUN.stopReq==='error';
  if(!quick){try{await ending();}catch(e){console.error(e);}}
  else{if(inGame&&S&&S.hp>0&&!TUT)DC.midRun=true;if(RUN.stopReq==='error'){recResume();V.end={big:'つづく',t0:performance.now()};await sleep(2500);}}
  recPause(false);think(false);
  const b=await stopRec(RC.main,RC.chunks);if(RC.pinch){const p=RC.pinch;RC.pinch=null;await stopRec(p,[]);}
  RC.state='idle';RC.main=null;
  DC.episode=RUN.ep;saveData();
  if(b)addFile(b,`hiyori_ep${RUN.ep}`,`本編 ${fmtT(RC.recMs)}`);
  RUN.done={title:RUN.title,hiyori:RUN.hiyori,runs:RUN.runs.slice(),cost:RUN.cost,dur:RC.recMs};
  bgmStop();closeModal();showTitle();showStage(false);if(WL){try{WL.release();}catch(e){}WL=null;}
  renderPanel();}

/* ---------- エラーのときの確認（録画は止まっている） ---------- */
function askError(e){return new Promise(res=>{recPause(false);const o=el('recErr');o.querySelector('p').textContent=e.message+(e.raw?`\n\n詳細：${String(e.raw).slice(0,200)}`:'');o.classList.remove('hidden');
  el('reRetry').onclick=()=>{o.classList.add('hidden');res('retry');};el('reStop').onclick=()=>{o.classList.add('hidden');res('stop');};});}
/* ---------- 実績のフック ---------- */
const _unlock=window.unlock;window.unlock=function(id){const had=!!(ACH&&ACH.u&&ACH.u[id]);const r=_unlock.apply(this,arguments);
  try{if(!had&&ACH.u[id]&&RUN&&RC.state!=='idle'){const a=ACHS.find(x=>x.id===id);if(a){RUN.achQ.push(a);RUN.achN++;}}}catch(e){}return r;};
window.shareRun=function(){};/* 収録モードでは作者へのプレイデータ送信をしない */

/* ---------- 画面を消さない ---------- */
let WL=null;async function wake(){try{if(navigator.wakeLock)WL=await navigator.wakeLock.request('screen');}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&RC.state!=='idle')wake();});

/* ---------- データの書き出し・読み込み・撮り直し ---------- */
const PFX='hiyori:',SKIP=[K.key,K.snap,K.cfg,K.cost].map(k=>PFX+k);
function hiyoriKeys(){const o=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(PFX)&&!SKIP.includes(k))o.push(k);}return o;}
function dumpData(){const d={};hiyoriKeys().forEach(k=>d[k]=REC_RAW.get(k));return d;}
function restoreData(d){hiyoriKeys().forEach(k=>REC_RAW.del(k));Object.keys(d).forEach(k=>{if(k.startsWith(PFX)&&!SKIP.includes(k))REC_RAW.set(k,d[k]);});}
function takeSnapshot(){jset(K.snap,{at:Date.now(),ep:DC.episode,data:dumpData()});}
function exportData(){const blob=new Blob([JSON.stringify({app:'dungeon-chain-hiyori',v:1,at:Date.now(),data:dumpData()},null,1)],{type:'application/json'});
  const d=new Date(),n=`hiyori_data_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=n;document.body.appendChild(a);a.click();a.remove();}
function importData(file){const fr=new FileReader();fr.onload=()=>{try{const j=JSON.parse(fr.result);if(j.app!=='dungeon-chain-hiyori'||!j.data)throw 0;
    if(!confirm('いまのヒヨリのデータを、このファイルの内容で置き換えます。よろしいですか？'))return;restoreData(j.data);location.reload();}catch(e){alert('読み込めませんでした（ヒヨリのデータファイルを選んでください）');}};fr.readAsText(file);}
function redo(){const s=jget(K.snap,null);if(!s||!s.data){alert('戻せるデータがありません');return;}
  if(!confirm(`第${s.ep+1}話を撮る前の状態に戻します（そのあとの進み具合・実績・死亡回数は消えます）。よろしいですか？`))return;restoreData(s.data);location.reload();}

/* ---------- 操作パネル・収録画面（DOM。録画には映らない） ---------- */
const css=document.createElement('style');css.textContent=`
#recPanel{position:fixed;inset:0;z-index:9000;background:#140e18;color:#ece4d8;overflow-y:auto;font-family:system-ui,sans-serif;padding:18px 16px 60px;-webkit-user-select:text;user-select:text}
#recPanel h1{font-size:22px;margin:0 0 4px}#recPanel .lead{color:#b9adc0;font-size:14px;margin:0 0 16px}
#recPanel .card{background:#211a25;border:1px solid #3a3040;border-radius:14px;padding:14px;margin:0 0 14px}
#recPanel label{display:block;font-size:14px;color:#c9bfcf;margin:10px 0 4px}#recPanel input,#recPanel select,#recPanel textarea{width:100%;box-sizing:border-box;font-size:17px;padding:10px;border-radius:10px;border:1px solid #4a3f52;background:#120d16;color:#fff}
#recPanel textarea{font-size:13px;height:120px}
#recPanel button{font-size:17px;padding:12px 14px;border-radius:12px;border:1px solid #5a4c63;background:#2c2333;color:#fff;margin:4px 4px 4px 0}
#recPanel .go{display:block;width:100%;font-size:22px;padding:18px;background:#ff5fa2;border:none;font-weight:800;margin:6px 0}#recPanel .go:disabled{opacity:.5}
#recPanel .row{display:flex;gap:8px}#recPanel .row>*{flex:1}#recPanel .rn{font-size:13px;color:#a99fae;line-height:1.6;border:0;background:none;padding:0;margin:6px 0;font-family:system-ui,sans-serif;box-shadow:none}#recPanel p,#recPanel div{font-family:system-ui,sans-serif}
#recPanel .big{font-size:20px;font-weight:800}#recPanel .ok{color:#8fe38f}#recPanel .ng{color:#ff9a9a}#recPanel a.dl{display:block;color:#ffd54a;font-size:17px;margin:8px 0}
#recStage{position:fixed;inset:0;z-index:8999;background:#000;display:flex;align-items:center;justify-content:center}#recStage canvas{height:100vh;width:auto;max-width:100vw;object-fit:contain}
#recBadge{position:fixed;top:8px;left:8px;z-index:9001;background:rgba(0,0,0,.7);color:#fff;font:700 15px system-ui;padding:6px 10px;border-radius:10px}
#recStop{position:fixed;top:8px;right:8px;z-index:9001;font:700 15px system-ui;padding:8px 12px;border-radius:10px;border:1px solid #a44;background:rgba(60,0,0,.8);color:#fff}
#recThink{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9001;background:rgba(0,0,0,.78);color:#fff;font:700 15px system-ui;padding:8px 14px;border-radius:20px;white-space:nowrap}
#recErr,#recAsk{position:fixed;inset:0;z-index:9002;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:20px}
#recErr>div,#recAsk>div{background:#211a25;border-radius:16px;padding:18px;max-width:420px;color:#fff;font-family:system-ui}#recErr p{white-space:pre-wrap;font-size:15px}
#recErr button,#recAsk button{display:block;width:100%;font-size:17px;padding:12px;margin:8px 0;border-radius:12px;border:1px solid #5a4c63;background:#2c2333;color:#fff}
.hidden{display:none!important}`;document.head.appendChild(css);
const host=document.createElement('div');host.innerHTML=`
<div id="recStage" class="hidden"><canvas id="recCanvas" width="${W}" height="${H}"></canvas></div>
<div id="recBadge" class="hidden"></div><button id="recStop" class="hidden">■ 終了</button><div id="recThink" class="hidden">🤔 ヒヨリが考え中…（ここは録画されません）</div>
<div id="recErr" class="hidden"><div><h3>⚠️ うまくいきませんでした</h3><p></p><button id="reRetry">もう一度ためす</button><button id="reStop">ここで終わって保存する</button></div></div>
<div id="recAsk" class="hidden"><div><h3>収録を終わりますか？</h3><button id="raEnd">エンディングを入れて終わる</button><button id="raNow">すぐ終わる（ここまでを保存）</button><button id="raBack">続ける</button></div></div>
<div id="recPanel"></div>`;document.body.appendChild(host);
RC.canvas=el('recCanvas');RC.x=RC.canvas.getContext('2d');requestAnimationFrame(drawStage);
function showStage(on){el('recStage').classList.toggle('hidden',!on);el('recBadge').classList.toggle('hidden',!on);el('recStop').classList.toggle('hidden',!on);el('recPanel').classList.toggle('hidden',on);if(!on)think(false);}
function think(on){el('recThink').classList.toggle('hidden',!on);}
function badge(){const b=el('recBadge');if(!b)return;tick();b.textContent=RC.state==='rec'?`● 録画中 ${fmtT(RC.recMs)} / ${CFG.minutes}:00`:RC.state==='paused'?`⏸ 一時停止 ${fmtT(RC.recMs)}`:'';}
setInterval(badge,500);
el('recStop').onclick=()=>el('recAsk').classList.remove('hidden');
el('raBack').onclick=()=>el('recAsk').classList.add('hidden');
el('raEnd').onclick=()=>{el('recAsk').classList.add('hidden');if(RUN)RUN.stopReq=RUN.stopReq||'user';};
el('raNow').onclick=()=>{el('recAsk').classList.add('hidden');if(RUN)RUN.stopReq='now';};
const esc2=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
function nextLabel(){const ep=DC.episode+1;if(DC.midRun&&slotJson(SLOT))return `第${ep}話（前回の続き：${slotLine0()}）`;if(!tutDoneFlag())return `第${ep}話（チュートリアルから）`;return `第${ep}話（新しい冒険）`;}
function ytText(){const d=RUN&&RUN.done;if(!d)return '';const ep=RUN.ep,res=d.runs.filter(x=>x.floor).map(x=>`${x.cls}でB${x.floor}F`).join('→')||`B${floorOf()}Fまで進んだ（続きは次回）`;
  return `【タイトル案】\n【Dungeon Chain】#${ep} ${d.title}｜ヒヨリのゲーム実況\n\n【説明欄】\n社会人2年目のヒヨリが、パズルRPG「Dungeon Chain」を実況プレイ！\n今回の結果：${res}（本日の日和り ${d.hiyori}回）\n\n▼遊んでいるゲーム\nDungeon Chain https://tkcy3.github.io/dungeon-chain/\n\n※この動画のプレイ・実況・音声は、すべてAI（キャラクター：ヒヨリ）によるものです。音声：Gemini TTS\n#ヒヨリ #DungeonChain #ゲーム実況${RUN.shorts?`\n\n【ショート用タイトル案】\nヒヨリ、B${(d.runs.filter(x=>x.floor).slice(-1)[0]||{}).floor||floorOf()}Fで散る #shorts #ヒヨリ`:''}`;}
function renderPanel(){const p=el('recPanel');const hasKey=!!KEY;const d=RUN&&RUN.done;
  p.innerHTML=`<h1>🎬 AI実況収録（ヒヨリ）</h1><p class="lead">ヒヨリがプレイと実況をして、字幕・声つきの縦長動画を保存します。データは普段のプレイとは別です。</p>
  ${d?`<div class="card"><div class="big">✅ 第${RUN.ep}話を保存しました</div><p class="rn">長さ ${fmtT(d.dur)}・日和り ${d.hiyori}回・今回の費用 約${yen(d.cost)}円</p>
    ${FILES.map(f=>`<a class="dl" href="${f.url}" download="${esc2(f.name)}">⬇️ ${esc2(f.label)}：${esc2(f.name)}（${(f.size/1048576).toFixed(1)}MB）</a>`).join('')}
    <p class="rn">ファイルは「ダウンロード」フォルダに入ります。YouTubeアプリの「＋」からアップロードしてください。</p>
    <label>YouTube用のタイトル・説明（コピーして使えます）</label><textarea id="ytT" readonly>${esc2(ytText())}</textarea><button id="ytC">📋 コピー</button></div>`:''}
  <div class="card"><div class="big">次は ${esc2(nextLabel())}</div><p class="rn">通算死亡 ${CHR.deaths}回・日和り累計 ${CHR.hiyori}回・気づきメモ ${DC.notes.length}件</p>
    <button class="go" id="rpGo" ${hasKey?'':'disabled'}>▶ 収録スタート</button>
    <p class="rn">${hasKey?'':'<span class="ng">先にAPIキーを保存してください。</span><br>'}収録中は画面を点けたまま、Chromeを前面にしておいてください。AIが考えている間は録画が自動で止まります。</p></div>
  <div class="card"><label>Gemini APIキー（この端末の中にだけ保存）</label><input id="rpKey" type="password" placeholder="AI Studio で作ったキーを貼り付け" value="${esc2(KEY)}"><button id="rpKeyS">保存</button><span id="rpKeyM" class="rn"></span>
    <label>声</label><select id="rpVoice">${VOICES.map(([v,d])=>`<option value="${v}" ${CFG.voice===v?'selected':''}>${v}（${d}）</option>`).join('')}</select>
    <button id="rpTest">🔊 声のテスト（あいさつ）</button><div id="rpTestM" class="rn"></div>
    <div class="row"><div><label>動画の長さ</label><select id="rpMin">${[8,10,15,20].map(m=>`<option value="${m}" ${CFG.minutes===m?'selected':''}>${m}分</option>`).join('')}</select></div>
    <div><label>下手さ</label><select id="rpHeta">${[[1,'弱（そこそこ考える）'],[2,'中（派手好き・雑）'],[3,'強（勢いだけ）']].map(([v,t])=>`<option value="${v}" ${CFG.heta===v?'selected':''}>${t}</option>`).join('')}</select></div></div>
    <details><summary class="rn">モデル名（ふつうは変えなくてOK）</summary><label>考える（テキスト）</label><input id="rpTM" value="${esc2(CFG.textModel)}"><label>声（TTS）</label><input id="rpSM" value="${esc2(CFG.ttsModel)}"></details>
    <p class="rn">費用の目安：累計 約${yen(COST.total)}円（1ドル=${YEN}円で計算）</p></div>
  <div class="card"><div class="big">ヒヨリのデータ</div><p class="rn">機種変更やブラウザのデータ削除に備えて、収録のたびに書き出しておくのがおすすめです。</p>
    <button id="rpEx">💾 書き出す</button><button id="rpIm">📥 読み込む</button><input id="rpFile" type="file" accept=".json,application/json" class="hidden">
    <button id="rpRedo">↩️ 直前の話を撮り直す</button>
    ${DC.notes.length?`<details><summary class="rn">気づきメモ（ヒヨリが自分で学んだこと）</summary><p class="rn">${DC.notes.map(esc2).join('<br>')}</p></details>`:''}</div>
  <p class="rn"><a href="./" style="color:#9fc7ff">← 普段のゲームに戻る</a></p>`;
  el('rpGo').onclick=runEpisode;
  el('rpKeyS').onclick=()=>{KEY=el('rpKey').value.trim();try{localStorage.setItem(K.key,KEY);}catch(e){}renderPanel();el('rpKeyM').textContent=KEY?' 保存しました':'';};
  el('rpVoice').onchange=e=>{CFG.voice=e.target.value;saveCfg();};el('rpMin').onchange=e=>{CFG.minutes=+e.target.value;saveCfg();};el('rpHeta').onchange=e=>{CFG.heta=+e.target.value;saveCfg();};
  el('rpTM').onchange=e=>{CFG.textModel=e.target.value.trim()||'gemini-3.5-flash-lite';saveCfg();};el('rpSM').onchange=e=>{CFG.ttsModel=e.target.value.trim()||'gemini-3.8-flash-lite-tts';saveCfg();};
  el('rpTest').onclick=voiceTest;el('rpEx').onclick=exportData;el('rpIm').onclick=()=>el('rpFile').click();el('rpFile').onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);};el('rpRedo').onclick=redo;
  if(el('ytC'))el('ytC').onclick=async()=>{const ok=await copyText(el('ytT').value);el('ytC').textContent=ok?'✅ コピーしました':'長押しで選んでコピーしてください';};}
async function voiceTest(){const m=el('rpTestM');KEY=el('rpKey').value.trim()||KEY;if(!KEY){m.innerHTML='<span class="ng">APIキーを入れてください</span>';return;}
  m.textContent='考え中…';try{setupAudio();const r=await llm(sysPrompt(),`${dateLine()}\n声のテストとして、視聴者にひとことあいさつして（30文字以内）。次のJSONだけを返す：{"text":"セリフ","emotion":"normal"}`);
    const t=(r&&r.text)||'はいどーも、ヒヨリでーす！';m.textContent='声を作っています…「'+noTags(t)+'」';const b=await tts(t,r&&EMOS.includes(r.emotion)?r.emotion:'normal');
    m.innerHTML=`<span class="ok">✅ つながりました</span>「${esc2(noTags(t))}」`;await playBuf(b);}
  catch(e){m.innerHTML=`<span class="ng">⚠️ ${esc2(e.message)}</span>${e.raw?`<br><small>${esc2(String(e.raw).slice(0,160))}</small>`:''}`;}}
closeModal();renderPanel();
window.HIYORI={CFG,DC,CHR,RC,V,analyze,bestHeuristic,run:()=>runEpisode()};
})();

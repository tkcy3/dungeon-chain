/* Dungeon Chain — 録画ファイルの仕上げ（AI実況収録モード用）
   AndroidのChromeの MediaRecorder が出す MP4 は「断片化MP4」で、
   ・動画の長さが書かれていない（プレーヤーで長さが 0:00 や変な値になる、シークできない）
   ・録画開始直後に一時停止すると、音声トラックの宣言が抜けることがある（音声データはあるのに再生されない）
   という問題がある。ここでは中身（映像・音声のデータ）はコピーせずにそのまま使い、
   目次（moov）だけを作り直して、普通のMP4として読めるようにする。
   fixMp4(blob, hint) → Promise<Blob>。直せないときは元の blob をそのまま返す。 */
(function(G){
'use strict';
const S4=(dv,o)=>String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3));
const U64=(dv,o)=>dv.getUint32(o)*4294967296+dv.getUint32(o+4);
async function rd(blob,pos,len){return new DataView(await blob.slice(pos,Math.min(blob.size,pos+len)).arrayBuffer());}
function* kids(dv,start,end){let p=start;while(p+8<=end){let sz=dv.getUint32(p);const t=S4(dv,p+4);let h=8;
  if(sz===1){sz=U64(dv,p+8);h=16;}else if(sz===0)sz=end-p;if(sz<h||p+sz>end)return;yield{t,p,sz,h};p+=sz;}}
const find=(dv,s,e,t)=>{for(const b of kids(dv,s,e))if(b.t===t)return b;return null;};
async function top(blob){const out=[];let p=0;const N=blob.size;
  while(p+8<=N){const dv=await rd(blob,p,16);let sz=dv.getUint32(0);const t=S4(dv,4);let h=8;
    if(sz===1){sz=U64(dv,8);h=16;}else if(sz===0)sz=N-p;if(sz<h)break;if(p+sz>N){out.push({t,p,sz:N-p,h,cut:true});break;}
    out.push({t,p,sz,h});p+=sz;}return out;}

/* ---- 書き出し用の小さな道具 ---- */
class W{constructor(){this.a=[];this.n=0;}
  u8(v){this.a.push(v&255);return this;}u16(v){return this.u8(v>>8).u8(v);}u24(v){return this.u8(v>>16).u8(v>>8).u8(v);}
  u32(v){v=v>>>0;return this.u8(v>>>24).u8(v>>>16).u8(v>>>8).u8(v);}u64(v){return this.u32(Math.floor(v/4294967296)).u32(v%4294967296);}
  s4(s){for(let i=0;i<4;i++)this.u8(s.charCodeAt(i));return this;}raw(b){for(let i=0;i<b.length;i++)this.a.push(b[i]);return this;}
  bytes(){return Uint8Array.from(this.a);}}
function box(type,...parts){let len=8;for(const p of parts)len+=p.length;const w=new W().u32(len).s4(type);const out=new Uint8Array(len);out.set(w.bytes(),0);let o=8;for(const p of parts){out.set(p,o);o+=p.length;}return out;}
const full=(v,f)=>new W().u8(v).u24(f).bytes();
const MATRIX=[0x10000,0,0,0,0x10000,0,0,0,0x40000000];

function runs(arr){const r=[];for(const v of arr){const l=r[r.length-1];if(l&&l[1]===v)l[0]++;else r.push([1,v]);}return r;}

/* 音声（AAC）の設定 */
const RATES=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000];
function aacEntry(rate,ch,br){const fi=Math.max(0,RATES.indexOf(rate));const asc=(2<<11)|(fi<<7)|(ch<<3);
  const dsi=new W().u8(5).u8(2).u16(asc).bytes(),sl=new W().u8(6).u8(1).u8(2).bytes();
  const dcd=new W().u8(4).u8(13+dsi.length).u8(0x40).u8(0x15).u24(0).u32(br).u32(br).raw(dsi).bytes();
  const esd=new W().u8(3).u8(3+dcd.length+sl.length).u16(0).u8(0).raw(dcd).raw(sl).bytes();
  const esds=box('esds',full(0,0),esd);
  const ent=box('mp4a',new W().u32(0).u16(0).u16(1).u32(0).u32(0).u16(ch).u16(16).u16(0).u16(0).u32(rate*65536).bytes(),esds);
  return box('stsd',full(0,0),new W().u32(1).bytes(),ent);}
function opusEntry(rate,ch){const dops=box('dOps',new W().u8(0).u8(ch).u16(312).u32(rate).u16(0).u8(0).bytes());
  const ent=box('Opus',new W().u32(0).u16(0).u16(1).u32(0).u32(0).u16(ch).u16(16).u16(0).u16(0).u32(48000*65536).bytes(),dops);
  return box('stsd',full(0,0),new W().u32(1).bytes(),ent);}

async function fixMp4(blob,hint={}){
  try{
    const tops=await top(blob);const moovB=tops.find(b=>b.t==='moov');if(!moovB)return blob;
    if(!tops.some(b=>b.t==='moof'))return blob; // すでに普通のMP4
    const mv=await rd(blob,moovB.p,moovB.sz);
    /* moov の中の既存トラック */
    const T={};const trex={};
    for(const b of kids(mv,moovB.h,moovB.sz)){
      if(b.t==='trak'){const tk=find(mv,b.p+b.h,b.p+b.sz,'tkhd');const md=find(mv,b.p+b.h,b.p+b.sz,'mdia');if(!tk||!md)continue;
        const v=mv.getUint8(tk.p+tk.h);const id=mv.getUint32(tk.p+tk.h+(v===1?20:12));
        const W_=mv.getUint32(tk.p+tk.sz-8),H_=mv.getUint32(tk.p+tk.sz-4);
        const mh=find(mv,md.p+md.h,md.p+md.sz,'mdhd'),hd=find(mv,md.p+md.h,md.p+md.sz,'hdlr'),mi=find(mv,md.p+md.h,md.p+md.sz,'minf');
        const mv1=mv.getUint8(mh.p+mh.h);const ts=mv.getUint32(mh.p+mh.h+(mv1===1?20:12));const lang=mv.getUint16(mh.p+mh.h+(mv1===1?32:20));
        const ty=S4(mv,hd.p+hd.h+8);const st=find(mv,mi.p+mi.h,mi.p+mi.sz,'stbl');const sd=st&&find(mv,st.p+st.h,st.p+st.sz,'stsd');
        T[id]={id,type:ty,ts,lang,w:W_,h:H_,stsd:sd?new Uint8Array(mv.buffer,mv.byteOffset+sd.p,sd.sz).slice():null,s:[]};}
      if(b.t==='mvex')for(const x of kids(mv,b.p+b.h,b.p+b.sz))if(x.t==='trex'){const o=x.p+x.h;trex[mv.getUint32(o+4)]={dur:mv.getUint32(o+12),size:mv.getUint32(o+16),flags:mv.getUint32(o+20)};}}
    /* 断片（moof）から、全サンプルの位置・長さ・時間を集める */
    const seen={};let dataStart=-1;
    for(const m of tops){if(m.t!=='moof')continue;if(dataStart<0)dataStart=m.p;
      const dv=await rd(blob,m.p,m.sz);
      for(const tf of kids(dv,m.h,m.sz)){if(tf.t!=='traf')continue;
        let id=0,base=m.p,dd=0,ds=0,df=0,bmdt=null,next=null;
        for(const x of kids(dv,tf.p+tf.h,tf.p+tf.sz)){const o=x.p+x.h;
          if(x.t==='tfhd'){const fl=dv.getUint32(o)&0xffffff;id=dv.getUint32(o+4);let q=o+8;const tr=trex[id]||{dur:0,size:0,flags:0};dd=tr.dur;ds=tr.size;df=tr.flags;
            if(fl&1){base=U64(dv,q);q+=8;}if(fl&2)q+=4;if(fl&8){dd=dv.getUint32(q);q+=4;}if(fl&0x10){ds=dv.getUint32(q);q+=4;}if(fl&0x20){df=dv.getUint32(q);q+=4;}}
          else if(x.t==='tfdt'){const v=dv.getUint8(o);bmdt=v===1?U64(dv,o+4):dv.getUint32(o+4);}
          else if(x.t==='trun'){const v=dv.getUint8(o),fl=dv.getUint32(o)&0xffffff,n=dv.getUint32(o+4);let q=o+8;
            let pos=next!==null?next:base;if(fl&1){pos=base+dv.getInt32(q);q+=4;}let ff=null;if(fl&4){ff=dv.getUint32(q);q+=4;}
            const tr=seen[id]||(seen[id]={s:[],t:null});if(bmdt!==null){tr.t=bmdt;bmdt=null;}if(tr.t===null)tr.t=0;
            for(let i=0;i<n;i++){const d=Math.max(1,fl&0x100?dv.getUint32(q):dd);if(fl&0x100)q+=4;const sz=fl&0x200?dv.getUint32(q):ds;if(fl&0x200)q+=4;
              let f=fl&0x400?dv.getUint32(q):(i===0&&ff!==null?ff:df);if(fl&0x400)q+=4;let c=0;if(fl&0x800){c=v===1?dv.getInt32(q):dv.getUint32(q);q+=4;}
              tr.s.push([tr.t,d,pos,sz,f,c]);pos+=sz;tr.t+=d;}
            next=pos;}}}}
    if(dataStart<0)return blob;
    /* 抜けている音声トラックを補う */
    const vid=Object.values(T).find(t=>t.type==='vide');
    for(const id of Object.keys(seen)){if(T[id])continue;const s=seen[id].s;if(!s.length)continue;
      const ticks=s[s.length-1][0]+s[s.length-1][1];let rate=hint.sampleRate||48000;
      if(vid&&seen[vid.id]&&seen[vid.id].s.length){const vs=seen[vid.id].s,vsec=(vs[vs.length-1][0]+vs[vs.length-1][1])/vid.ts;
        if(vsec>1){const est=ticks/vsec;rate=RATES.reduce((a,b)=>Math.abs(b-est)<Math.abs(a-est)?b:a,48000);}}
      const opus=/opus/i.test(hint.codec||'');let ch=hint.channels||2;
      if(!opus){const fb=(await rd(blob,s[0][2],1)).getUint8(0);ch=(fb>>5)===1?2:(fb>>5)===0?1:ch;}
      T[id]={id:+id,type:'soun',ts:opus?48000:rate,lang:0x55c4,w:0,h:0,stsd:opus?opusEntry(rate,ch):aacEntry(rate,ch,hint.bitrate||128000),s:[]};}
    for(const id of Object.keys(T))T[id].s=(seen[id]&&seen[id].s)||[];
    const tracks=Object.values(T).filter(t=>t.s.length&&t.stsd).sort((a,b)=>a.type===b.type?a.id-b.id:(a.type==='vide'?-1:1));
    if(!tracks.length)return blob;
    /* 新しい目次を組み立てる（2回：1回目で長さを測り、2回目で位置を確定） */
    const payload=blob.size-dataStart;const big=payload+8>0xFFFFFFFF;
    const ftyp=box('ftyp',new W().s4('isom').u32(512).s4('isom').s4('iso2').s4('avc1').s4('mp41').bytes());
    const build=(shift)=>{const use64=shift+payload>0xFFFFFFFF;let mvDur=0;const traks=[];let nid=1;
      for(const t of tracks){const s=t.s,first=s[0][0];const dur=s[s.length-1][0]+s[s.length-1][1]-first;const ms=Math.round(dur*1000/t.ts);mvDur=Math.max(mvDur,ms);nid=Math.max(nid,t.id+1);
        const stts=runs(s.map(x=>x[1]));const sttsB=new W().u32(stts.length);for(const[r,v]of stts)sttsB.u32(r).u32(v);
        const parts=[t.stsd,box('stts',full(0,0),sttsB.bytes())];
        if(s.some(x=>x[5]!==0)){const neg=s.some(x=>x[5]<0);const c=runs(s.map(x=>x[5]));const w=new W().u32(c.length);for(const[r,v]of c)w.u32(r).u32(v);parts.push(box('ctts',full(neg?1:0,0),w.bytes()));}
        if(t.type==='vide'){const ss=[];s.forEach((x,i)=>{if(!(x[4]&0x10000))ss.push(i+1);});if(ss.length&&ss.length<s.length){const w=new W().u32(ss.length);ss.forEach(i=>w.u32(i));parts.push(box('stss',full(0,0),w.bytes()));}}
        parts.push(box('stsc',full(0,0),new W().u32(1).u32(1).u32(1).u32(1).bytes()));
        const sz=new W().u32(0).u32(s.length);s.forEach(x=>sz.u32(x[3]));parts.push(box('stsz',full(0,0),sz.bytes()));
        const co=new W().u32(s.length);s.forEach(x=>{const p=x[2]-dataStart+shift;use64?co.u64(p):co.u32(p);});parts.push(box(use64?'co64':'stco',full(0,0),co.bytes()));
        const stbl=box('stbl',...parts);
        const dinf=box('dinf',box('dref',full(0,0),new W().u32(1).bytes(),box('url ',full(0,1))));
        const mhd=t.type==='vide'?box('vmhd',full(0,1),new W().u16(0).u16(0).u16(0).u16(0).bytes()):box('smhd',full(0,0),new W().u16(0).u16(0).bytes());
        const name=t.type==='vide'?'VideoHandler':'SoundHandler';const hw=new W().u32(0).s4(t.type).u32(0).u32(0).u32(0);for(const c of name)hw.u8(c.charCodeAt(0));hw.u8(0);
        const mdia=box('mdia',box('mdhd',full(0,0),new W().u32(0).u32(0).u32(t.ts).u32(dur).u16(t.lang||0x55c4).u16(0).bytes()),box('hdlr',full(0,0),hw.bytes()),box('minf',mhd,dinf,stbl));
        const tk=new W().u32(0).u32(0).u32(t.id).u32(0).u32(ms).u32(0).u32(0).u16(0).u16(t.type==='soun'?1:0).u16(t.type==='soun'?0x100:0).u16(0);MATRIX.forEach(m=>tk.u32(m));tk.u32(t.w).u32(t.h);
        const kidsT=[box('tkhd',full(0,3),tk.bytes())];
        if(first>0){const el=new W().u32(1).u32(ms).u32(first).u16(1).u16(0);kidsT.push(box('edts',box('elst',full(0,0),el.bytes())));}
        kidsT.push(mdia);traks.push(box('trak',...kidsT));}
      const mh=new W().u32(0).u32(0).u32(1000).u32(mvDur).u32(0x10000).u16(0x100).u16(0).u32(0).u32(0);MATRIX.forEach(m=>mh.u32(m));for(let i=0;i<6;i++)mh.u32(0);mh.u32(nid);
      return box('moov',box('mvhd',full(0,0),mh.bytes()),...traks);};
    const hdrLen=big?16:8;let moov=build(0);let shift=ftyp.length+moov.length+hdrLen;moov=build(shift);
    if(ftyp.length+moov.length+hdrLen!==shift){shift=ftyp.length+moov.length+hdrLen;moov=build(shift);}
    const mdatH=big?new W().u32(1).s4('mdat').u64(payload+16).bytes():new W().u32(payload+8).s4('mdat').bytes();
    return new Blob([ftyp,moov,mdatH,blob.slice(dataStart)],{type:'video/mp4'});
  }catch(e){try{console.warn('fixMp4',e);}catch(_){}return blob;}}
G.fixMp4=fixMp4;
})(typeof window!=='undefined'?window:globalThis);

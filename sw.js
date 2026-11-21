// Dungeon Chain: offline cache. Network first so updates arrive; cache as fallback.
const C='dchain-v14',FILES=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;
  const same=new URL(e.request.url).origin===location.origin;
  /* no-cache: 毎回サーバーに更新確認（変わっていなければ軽い304）。GitHub Pagesの10分キャッシュで古い版が出るのを防ぐ */
  e.respondWith(fetch(e.request,same?{cache:'no-cache'}:undefined).then(r=>{if(r.ok&&new URL(e.request.url).origin===location.origin){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r;}).catch(()=>caches.match(e.request).then(m=>m||caches.match('./index.html'))));});

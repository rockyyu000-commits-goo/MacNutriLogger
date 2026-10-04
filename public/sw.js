const C='macnutri-v1',ASSETS=['/','/app.js','/style.css','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS))));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname==='/api/data'){ // network first so menu edits show up; cached copy works offline
    e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));
  }else if(!u.pathname.startsWith('/api/')){
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
  }
});

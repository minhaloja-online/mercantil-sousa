/* MercadoPDV — Service Worker
   Guarda em cache os arquivos do app (HTML/CSS/JS/ícones) para abrir
   offline. Os dados (produtos, vendas, etc.) ficam offline por conta
   da persistência automática do Firestore, configurada em app.js. */
const CACHE_NAME = 'mercadopdv-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=> cache.addAll(APP_SHELL)).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const url = new URL(event.request.url);
  // Só cuida do app shell (mesma origem). Firebase/CDN seguem direto para a rede
  // (o SDK do Firestore já cuida do cache/offline dos dados).
  if(url.origin !== self.location.origin){ return; }
  if(event.request.method !== 'GET'){ return; }

  event.respondWith(
    caches.match(event.request).then(cached=>{
      const network = fetch(event.request).then(resp=>{
        if(resp && resp.status===200){
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache=> cache.put(event.request, clone));
        }
        return resp;
      }).catch(()=> cached);
      return cached || network;
    })
  );
});

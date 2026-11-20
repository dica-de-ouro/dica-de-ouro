// Dica de Ouro: uso sem internet.
// A página vem sempre da rede quando há conexão (assim cada publicação aparece na hora);
// sem conexão, abre a última cópia guardada. Leituras públicas do Supabase seguem a mesma
// regra, para que a home e as fichas já vistas abram no modo avião. Nada que leve o login
// do anunciante é guardado, e nenhuma gravação passa por aqui.
const VERSAO = 'dica-v1';
const ESSENCIAIS = [
  '/',
  '/manifest.json',
  '/imagembase.webp',
  '/icon-192.png',
  '/fonts/fraunces-latin-opsz-normal.woff2',
  '/fonts/fraunces-latin-opsz-italic.woff2',
  '/fonts/inter-latin-wght-normal.woff2'
];
const LIMITE_DADOS = 150; // respostas do Supabase guardadas

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n.startsWith('dica-') && n !== VERSAO && n !== VERSAO + '-dados').map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro; se a rede falhar ou demorar demais, a cópia guardada
async function redePrimeiro(req, cache, chave, espera) {
  const rede = fetch(req).then(resp => {
    if (resp && resp.ok) {
      const copia = resp.clone();
      caches.open(cache).then(c => c.put(chave || req, copia)).then(() => cache.endsWith('-dados') ? aparar(cache) : null);
    }
    return resp;
  });
  rede.catch(() => {});
  try {
    return await (espera
      ? Promise.race([rede, new Promise((_, falha) => setTimeout(() => falha(new Error('lenta')), espera))])
      : rede);
  } catch (e) {
    const guardada = await caches.open(cache).then(c => c.match(chave || req));
    // Sem cópia guardada: fica com a resposta da rede, mesmo que demore
    return guardada || rede;
  }
}

// Arquivos do próprio site: a cópia guardada na hora, atualizada por trás
async function guardadaPrimeiro(req) {
  const c = await caches.open(VERSAO);
  const g = await c.match(req);
  const atualiza = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  return g || (await atualiza) || Response.error();
}

async function aparar(cache) {
  const c = await caches.open(cache);
  const chaves = await c.keys();
  for (let i = 0; i < chaves.length - LIMITE_DADOS; i++) await c.delete(chaves[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // A página: rede primeiro (até 6 s), senão a última cópia. Outras páginas do site, sem cópia, caem na home guardada
  if (req.mode === 'navigate' && url.origin === location.origin) {
    const home = url.pathname === '/' || url.pathname === '/index.html';
    e.respondWith(home ? redePrimeiro(req, VERSAO, '/', 6000)
      : fetch(req).catch(() => caches.open(VERSAO).then(c => c.match('/')).then(g => g || Response.error())));
    return;
  }

  // Leituras públicas do Supabase (a chave pública vai nos dois cabeçalhos; com o login do anunciante, não guarda)
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/')) {
    const publica = req.headers.get('apikey') && req.headers.get('authorization') === 'Bearer ' + req.headers.get('apikey');
    if (publica) e.respondWith(redePrimeiro(req, VERSAO + '-dados', null, 8000));
    return;
  }

  // Leaflet (versão fixa no endereço)
  if (url.hostname === 'unpkg.com' && url.pathname.includes('/leaflet@1.9.4/')) {
    e.respondWith(guardadaPrimeiro(req));
    return;
  }

  // Imagens, fontes e manifesto do próprio site
  if (url.origin === location.origin && /\.(webp|png|jpg|jpeg|svg|woff2|json)$/.test(url.pathname)) {
    e.respondWith(guardadaPrimeiro(req));
  }
});

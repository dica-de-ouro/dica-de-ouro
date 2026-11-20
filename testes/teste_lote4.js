// Testes do lote 4 (computador, fontes próprias e uso sem internet), sem gravar nada no banco
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8000/';
const resultados = [];
const ok = (nome, cond, info = '') => resultados.push({ nome, ok: !!cond, info });
const espera = ms => new Promise(r => setTimeout(r, ms));
const errosPagina = [];
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;

async function novaPagina(browser, { largura = 1440, altura = 900, movel = false, interceptar = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 1, isMobile: movel, hasTouch: movel });
  page.__req = [];
  page.on('request', req => page.__req.push(req.url()));
  if (interceptar) {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.isInterceptResolutionHandled()) return;
      if (req.url().includes('supabase.co') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return req.abort();
      req.continue();
    });
  }
  page.on('pageerror', e => errosPagina.push(String(e.message).slice(0, 200)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('dica_visitou', '1');
    const f = window.fetch.bind(window);
    window.fetch = (u, o = {}) => (String(u).includes('supabase.co') && (o.method || 'GET') !== 'GET') ? Promise.resolve(new Response(null, { status: 201 })) : f(u, o);
  });
  return page;
}
const caixa = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), d: getComputedStyle(e).display }; }, sel);

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', ...(PROXY ? ['--proxy-server=' + PROXY] : [])] });
  try {
    // ---------------------------------------------------------- computador 1440
    const p = await novaPagina(browser);
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await p.waitForFunction(() => document.querySelectorAll('#lista-lojas .lugar, #card-ev-lista .ev-row').length > 0, { timeout: 30000 });
    await espera(600);
    const barra = await caixa(p, '#tabbar');
    const marca = await caixa(p, '.tab-marca');
    ok('Barra superior com a marca no computador', barra && barra.t === 0 && barra.h === 64 && marca && marca.d === 'block', JSON.stringify({ barra, marca }));
    const lista = await caixa(p, '#lista-lojas'), lado = await caixa(p, '#secao-destaque'), hero = await caixa(p, '#tela-home .hero');
    ok('Home: lista à esquerda e "Acontece hoje" à direita', lista && lado && lado.l >= lista.r && lado.w >= 360, JSON.stringify({ lista, lado }));
    ok('Gravura de ponta a ponta', hero && hero.l === 0 && hero.w === 1440, JSON.stringify(hero));
    const faixa = Math.min(lista.l, 1440 - lado.r);
    ok('Nenhuma faixa vazia maior que 15% da largura (1440 px)', faixa <= 216, `faixas de ${lista.l} e ${1440 - lado.r} px`);
    const colunas = await p.evaluate(() => getComputedStyle(document.getElementById('lista-lojas')).gridTemplateColumns.split(' ').length);
    ok('Lista em duas colunas', colunas === 2, String(colunas));
    // fontes
    const fontes = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.style));
    const google = p.__req.filter(u => /fonts\.(googleapis|gstatic)\.com/.test(u));
    ok('Fontes do próprio site, nada do Google Fonts', google.length === 0 && fontes.some(f => /Fraunces/.test(f)) && fontes.some(f => /Inter/.test(f)), fontes.join(', '));
    // agenda
    await p.evaluate(() => irTab('tela-agenda', 'tab-agenda'));
    await p.waitForFunction(() => document.querySelectorAll('#agenda-feed .ev-card').length > 1, { timeout: 30000 });
    const colAgenda = await p.evaluate(() => getComputedStyle(document.getElementById('agenda-feed')).gridTemplateColumns.split(' ').length);
    ok('Agenda em duas colunas', colAgenda === 2, String(colAgenda));
    // explorar
    await p.evaluate(() => irTab('tela-explorar', 'tab-explorar'));
    await p.waitForFunction(() => document.querySelectorAll('#mapa-lista .lugar').length > 20, { timeout: 45000 }).catch(() => {});
    const mapa = await caixa(p, '#mapa-container'), listaMapa = await caixa(p, '#mapa-lista');
    const itens = await p.evaluate(() => document.querySelectorAll('#mapa-lista .lugar').length);
    ok('Explorar: lista e mapa lado a lado', mapa && listaMapa && listaMapa.d === 'block' && listaMapa.r <= mapa.l + 1 && mapa.w > 900 && itens > 20, JSON.stringify({ mapa, listaMapa, itens }));
    await p.evaluate(() => [...document.querySelectorAll('.mapa-filtro')].find(b => b.textContent.trim() === 'Museus').click());
    await espera(500);
    const museus = await p.evaluate(() => [...new Set([...document.querySelectorAll('#mapa-lista .cat-tag')].map(c => c.textContent.split(' · ')[0]))].join());
    ok('Filtro do mapa vale para a lista ao lado', museus === 'Museus', museus);
    // ficha
    await p.evaluate(() => abrirLugaresPorCat('Igrejas'));
    await p.waitForFunction(() => document.querySelectorAll('#agenda-feed [onclick]').length > 3, { timeout: 30000 });
    await p.evaluate(() => document.querySelectorAll('#agenda-feed [onclick]')[0].click());
    await espera(800);
    const foto = await caixa(p, '#tela-lugar .evento-hero'), corpo = await caixa(p, '#tela-lugar .evento-corpo'), cta = await caixa(p, '#tela-lugar .cta-evento');
    ok('Ficha: foto à esquerda, texto e ações à direita', foto && corpo && foto.r <= corpo.l && foto.h > 700 && cta && cta.l >= corpo.l - 10, JSON.stringify({ foto, corpo, cta }));
    await p.screenshot({ path: require('path').join(require('os').tmpdir(), 'lote4_ficha_1440.png') });

    // ---------------------------------------------------------- celular continua igual
    const m = await novaPagina(browser, { largura: 390, altura: 844, movel: true });
    await m.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(500);
    const barraM = await caixa(m, '#tabbar');
    ok('Celular: barra continua embaixo e sem a marca', barraM && barraM.b === 844 && (await caixa(m, '.tab-marca')).d === 'none', JSON.stringify(barraM));

    // ---------------------------------------------------------- sem internet
    const o = await novaPagina(browser, { largura: 390, altura: 844, movel: true, interceptar: false });
    await o.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await o.evaluate(() => navigator.serviceWorker.ready);
    await o.reload({ waitUntil: 'networkidle2', timeout: 90000 });   // agora controlada pelo sw.js, guarda as leituras
    await o.waitForFunction(() => document.querySelectorAll('#card-ev-lista .ev-row').length > 0, { timeout: 30000 });
    const ctrl = await o.evaluate(() => !!navigator.serviceWorker.controller);
    // vê uma ficha antes de cair a conexão
    await o.evaluate(() => abrirLugaresPorCat('Igrejas'));
    await o.waitForFunction(() => document.querySelectorAll('#agenda-feed [onclick]').length > 3, { timeout: 30000 });
    await o.evaluate(() => document.querySelectorAll('#agenda-feed [onclick]')[0].click());
    await espera(1500);
    const fichaOn = await o.evaluate(() => ({ rota: location.hash, titulo: document.getElementById('lugar-nome')?.textContent.trim() }));
    await o.evaluate(() => irTab('tela-home', 'tab-inicio'));
    await espera(1500);
    await o.setOfflineMode(true);
    await o.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await espera(4000);
    const off = await o.evaluate(() => ({ tela: telaAtual, aviso: !document.getElementById('aviso-conexao').hidden, eventos: document.querySelectorAll('#card-ev-lista .ev-row').length, titulo: document.querySelector('.hero-titulo')?.textContent }));
    ok('Sem internet: a home abre com os dados guardados e o aviso', ctrl && off.tela === 'tela-home' && off.aviso && off.eventos > 0, JSON.stringify({ ctrl, ...off }));
    await o.evaluate(() => abrirLugaresPorCat('Igrejas'));
    await o.waitForFunction(() => document.querySelectorAll('#agenda-feed [onclick]').length > 3, { timeout: 15000 }).catch(() => {});
    await o.evaluate(() => document.querySelectorAll('#agenda-feed [onclick]')[0]?.click());
    await espera(1500);
    const fichaOff = await o.evaluate(() => ({ tela: telaAtual, titulo: document.getElementById('lugar-nome')?.textContent.trim() }));
    ok('Sem internet: a lista e a ficha já vistas abrem', fichaOff.tela === 'tela-lugar' && fichaOff.titulo && fichaOff.titulo === fichaOn.titulo, JSON.stringify({ fichaOn, fichaOff }));
    await o.goto(BASE + fichaOn.rota, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await o.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await espera(4000);
    const direta = await o.evaluate(() => ({ tela: telaAtual, titulo: document.getElementById('lugar-nome')?.textContent.trim() }));
    ok('Sem internet: o link direto de uma ficha já vista abre', direta.tela === 'tela-lugar' && direta.titulo === fichaOn.titulo, JSON.stringify(direta));
    await o.setOfflineMode(false);
  } catch (err) {
    ok('Execução sem falhas', false, String(err.stack || err).slice(0, 400));
  } finally {
    ok('Sem erros de JavaScript', errosPagina.length === 0, errosPagina.slice(0, 5).join(' | '));
    await browser.close();
    resultados.forEach(r => console.log(`${r.ok ? 'OK  ' : 'FALHA'} ${r.nome}${r.info ? '  — ' + r.info : ''}`));
    console.log(`\n${resultados.filter(r => r.ok).length}/${resultados.length} verificações passaram`);
  }
})();

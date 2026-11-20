// Testes do lote 5 (aba Mobilidade), sem gravar nada no banco
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8000/';
const resultados = [];
const ok = (nome, cond, info = '') => resultados.push({ nome, ok: !!cond, info });
const espera = ms => new Promise(r => setTimeout(r, ms));
const errosPagina = [];
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;

async function novaPagina(browser, { largura = 390, altura = 844, movel = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 1, isMobile: movel, hasTouch: movel });
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.isInterceptResolutionHandled()) return;
    if (req.url().includes('supabase.co') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return req.abort();
    req.continue();
  });
  page.on('pageerror', e => errosPagina.push(String(e.message).slice(0, 200)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('dica_visitou', '1');
    const f = window.fetch.bind(window);
    window.fetch = (u, o = {}) => (String(u).includes('supabase.co') && (o.method || 'GET') !== 'GET') ? Promise.resolve(new Response(null, { status: 201 })) : f(u, o);
  });
  return page;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', ...(PROXY ? ['--proxy-server=' + PROXY] : [])] });
  try {
    // ---------------------------------------------------------- celular 390
    const p = await novaPagina(browser);
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(800);
    const abas = await p.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].map(t => ({ t: t.textContent.trim(), cabe: t.scrollWidth <= t.clientWidth + 1 })));
    ok('Barra com cinco abas, Mobilidade antes de Salvos', abas.map(a => a.t).join() === 'Início,Agenda,Explorar,Mobilidade,Salvos', abas.map(a => a.t).join(', '));
    ok('Rótulos das abas cabem em 390 px', abas.every(a => a.cabe), JSON.stringify(abas));
    await p.evaluate(() => document.getElementById('tab-mobilidade').click());
    await espera(700);
    const tela = await p.evaluate(() => ({ tela: telaAtual, hash: location.hash, ativa: document.getElementById('tab-mobilidade').classList.contains('ativo'), titulo: document.querySelector('#tela-mobilidade h2').textContent, secoes: [...document.querySelectorAll('#tela-mobilidade .mob-secao h3')].map(e => e.textContent), larg: document.getElementById('tela-mobilidade').scrollWidth <= innerWidth }));
    ok('A aba abre a tela Mobilidade em #/mobilidade', tela.tela === 'tela-mobilidade' && tela.hash === '#/mobilidade' && tela.ativa, JSON.stringify(tela));
    ok('Seis seções: ônibus, outras cidades, táxi, lotação, apps e telefones', tela.secoes.length === 6 && /Ônibus/.test(tela.secoes[0]) && /Telefones/.test(tela.secoes[5]), tela.secoes.join(' | '));
    ok('Nada passa da largura da tela', tela.larg);
    const apps = await p.evaluate(() => ({ nomes: [...document.querySelectorAll('#mob-apps .mob-app h4')].map(e => e.textContent), aviso: document.querySelector('#mob-apps > p')?.textContent || '' }));
    ok('Apps: sem Uber, com o aviso de que ela não funciona na cidade', !apps.nomes.includes('Uber') && /Uber não funciona/.test(apps.aviso), JSON.stringify(apps));
    await p.screenshot({ path: require('path').join(require('os').tmpdir(), 'lote5_mobilidade_390.png') });
    // links
    const links = await p.evaluate(() => [...document.querySelectorAll('#tela-mobilidade a')].map(a => ({ h: a.getAttribute('href'), t: a.getAttribute('target'), r: a.getAttribute('rel') })));
    const fones = links.filter(l => l.h.startsWith('tel:'));
    ok('Telefones tocáveis no formato certo', fones.length >= 20 && fones.every(l => /^tel:(\+55\d{10,11}|0800\d{7}|\d{3})$/.test(l.h)), fones.filter(l => !/^tel:(\+55\d{10,11}|0800\d{7}|\d{3})$/.test(l.h)).map(l => l.h).join(', ') || fones.length + ' telefones');
    const externos = links.filter(l => /^https?:/.test(l.h));
    ok('Links externos em https e em nova aba', externos.length >= 7 && externos.every(l => l.h.startsWith('https://') && l.t === '_blank' && /noopener/.test(l.r || '')), externos.length + ' links');
    // atalhos
    await p.evaluate(() => [...document.querySelectorAll('.mob-atalhos .chip-periodo')].find(b => /Telefones/.test(b.textContent)).click());
    await espera(1200);
    const topo = await p.evaluate(() => Math.round(document.getElementById('mob-telefones').getBoundingClientRect().top));
    ok('Atalho "Telefones" leva à seção', topo >= -2 && topo < 60, 'topo a ' + topo + ' px');
    // voltar
    await p.goBack();
    await espera(800);
    ok('Voltar do celular sai da Mobilidade', await p.evaluate(() => telaAtual !== 'tela-mobilidade'), await p.evaluate(() => telaAtual + ' ' + location.hash));

    // ---------------------------------------------------------- link direto e tela de 360 px
    const d = await novaPagina(browser, { largura: 360, altura: 740 });
    await d.goto(BASE + '#/mobilidade', { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(1500);
    const dir = await d.evaluate(() => ({ tela: telaAtual, cabe: [...document.querySelectorAll('#tabbar .tab')].every(t => t.scrollWidth <= t.clientWidth + 1), larg: document.getElementById('tela-mobilidade').scrollWidth <= innerWidth }));
    ok('Link direto #/mobilidade abre a tela (360 px, tudo cabe)', dir.tela === 'tela-mobilidade' && dir.cabe && dir.larg, JSON.stringify(dir));

    // ---------------------------------------------------------- computador 1440
    const c = await novaPagina(browser, { largura: 1440, altura: 900, movel: false });
    await c.goto(BASE + '#/mobilidade', { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(1500);
    const comp = await c.evaluate(() => {
      const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top) }; };
      return { barra: [...document.querySelectorAll('#tabbar .tab')].map(t => t.textContent.trim()).includes('Mobilidade'), onibus: r('mob-onibus'), viagem: r('mob-viagem'), fones: r('mob-telefones'), larg: document.getElementById('tela-mobilidade').scrollWidth <= innerWidth };
    });
    ok('Computador: seções em duas colunas e telefones na largura toda', comp.barra && comp.viagem.l > comp.onibus.r && comp.onibus.t === comp.viagem.t && comp.fones.l === comp.onibus.l && comp.fones.r === comp.viagem.r && comp.larg, JSON.stringify(comp));
    await c.screenshot({ path: require('path').join(require('os').tmpdir(), 'lote5_mobilidade_1440.png') });
  } catch (err) {
    ok('Execução sem falhas', false, String(err.stack || err).slice(0, 400));
  } finally {
    ok('Sem erros de JavaScript', errosPagina.length === 0, errosPagina.slice(0, 5).join(' | '));
    await browser.close();
    resultados.forEach(r => console.log(`${r.ok ? 'OK  ' : 'FALHA'} ${r.nome}${r.info ? '  — ' + r.info : ''}`));
    console.log(`\n${resultados.filter(r => r.ok).length}/${resultados.length} verificações passaram`);
  }
})();

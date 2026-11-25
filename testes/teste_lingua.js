// Testes do lote 6 (site em português, inglês, espanhol e francês), sem gravar nada no banco
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8000/';
const resultados = [];
const ok = (nome, cond, info = '') => resultados.push({ nome, ok: !!cond, info });
const espera = ms => new Promise(r => setTimeout(r, ms));
const errosPagina = [];
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;

async function novaPagina(browser, { lingua = null, visitou = true, largura = 390, altura = 844, movel = true } = {}) {
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
  await page.evaluateOnNewDocument((lingua, visitou) => {
    if (!sessionStorage.getItem('preparado')) {
      sessionStorage.setItem('preparado', '1');
      if (visitou) localStorage.setItem('dica_visitou', '1');
      if (lingua) localStorage.setItem('dica_lingua', lingua);
    }
  }, lingua, visitou);
  return page;
}
const abas = p => p.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].map(t => t.textContent.trim()).join(','));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', ...(PROXY ? ['--proxy-server=' + PROXY] : [])] });
  try {
    // ---------------------------------------------------------- sem escolha: navegador automático fica no português
    let p = await novaPagina(browser);
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(600);
    ok('Sem escolha salva, robôs e testes veem o português', (await abas(p)) === 'Início,Agenda,Explorar,Mobilidade,Salvos' && await p.evaluate(() => document.documentElement.lang === 'pt-BR'));
    ok('Em português o aviso da agenda fica escondido', await p.evaluate(() => document.querySelector('.aviso-lingua').hidden));
    await p.close();

    // ---------------------------------------------------------- inglês
    p = await novaPagina(browser, { lingua: 'en' });
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(1200);
    ok('Inglês: abas traduzidas', (await abas(p)) === 'Home,Events,Explore,Transport,Saved', await abas(p));
    ok('Inglês: <html lang="en-US">', await p.evaluate(() => document.documentElement.lang === 'en-US'));
    const titulo = await p.evaluate(() => document.querySelector('#tela-home .hero-titulo').innerHTML.trim());
    ok('Inglês: título da home com a palavra em itálico', titulo === 'What to see and do in Ouro Preto <em>today</em>.', titulo);
    const cabem = await p.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].every(t => t.scrollWidth <= t.clientWidth + 1));
    ok('Inglês: rótulos das abas cabem em 390 px', cabem);
    const btn = await p.evaluate(() => { const b = document.querySelector('#tela-home .btn-lingua'); const r = b.getBoundingClientRect(); return { cod: b.textContent.trim(), alvo: r.height >= 44, label: b.getAttribute('aria-label') }; });
    ok('Botão de idioma no topo da home mostra EN e tem alvo de 44 px', btn.cod === 'EN' && btn.alvo, JSON.stringify(btn));
    const destaque = await p.evaluate(() => document.getElementById('destaque-desc')?.textContent || '');
    ok('Em destaque: descrição do lugar em inglês', destaque.length > 20 && !/\b(com|para|uma|das)\b/.test(destaque), destaque.slice(0, 80));

    // ficha de um museu: nome em português, descrição e horário em inglês
    await p.evaluate(() => { location.hash = '#/lugar/museu-da-inconfidencia-b5095f'; });
    await espera(3000);
    const ficha = await p.evaluate(() => ({ nome: document.getElementById('lugar-nome').textContent.trim(), desc: document.getElementById('lugar-desc').textContent, infos: document.getElementById('lugar-infos').innerText, sobre: document.querySelector('#tela-lugar h3, #tela-lugar .sec-titulo')?.innerHTML || '', titulo: document.title }));
    ok('Ficha: nome do lugar fica em português', ficha.nome === 'Museu da Inconfidência', ficha.nome);
    ok('Ficha: descrição em inglês', /^A museum in the former Town Hall and Jail/.test(ficha.desc), ficha.desc.slice(0, 60));
    ok('Ficha: horário em inglês, com rótulo traduzido', /hours/i.test(ficha.infos) && /Tuesday to Thursday/.test(ficha.infos) && /address/i.test(ficha.infos), ficha.infos.replace(/\s+/g, ' ').slice(0, 160));
    ok('Ficha: título da aba do navegador', /Museu da Inconfidência · Dica de Ouro/.test(ficha.titulo), ficha.titulo);

    // nome com palavra solta antes do itálico não é traduzido pela metade
    await p.evaluate(() => { location.hash = '#/lugar/museu-boulieu-494030'; });
    await espera(2500);
    const boulieu = await p.evaluate(() => document.getElementById('lugar-nome').textContent.trim());
    ok('Ficha: "Museu Boulieu" não vira "Museum Boulieu"', boulieu === 'Museu Boulieu', boulieu);

    // agenda: datas no formato inglês e aviso de que os eventos ficam em português
    await p.evaluate(() => irTab('tela-agenda', 'tab-agenda'));
    await espera(1500);
    const agenda = await p.evaluate(() => ({ aviso: document.querySelector('.aviso-lingua'), txt: document.getElementById('tela-agenda').innerText }));
    const aviso = await p.evaluate(() => { const a = document.querySelector('.aviso-lingua'); return !a.hidden && a.offsetParent !== null && a.textContent; });
    ok('Agenda: aviso de que os eventos aparecem em português', aviso === 'Events are shown in Portuguese, as published by the organizers.', String(aviso));
    ok('Agenda: datas com meses em inglês', /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(agenda.txt) && !/\b(nov|dez)\b\.?\s/.test(agenda.txt.replace(/Nov|Dec/g, '')), agenda.txt.slice(0, 200).replace(/\s+/g, ' '));
    ok('Agenda: filtros traduzidos', /Tonight/.test(agenda.txt) && /Weekend/.test(agenda.txt) && /Nearby/.test(agenda.txt));

    // busca acha lugar pela descrição traduzida
    await p.evaluate(() => { irTab('tela-home', 'tab-inicio'); const i = document.getElementById('input-busca'); i.value = 'muleteer'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await espera(2500);
    const busca = await p.evaluate(() => document.body.innerText.match(/\d+ results? for "muleteer"/)?.[0] || '');
    ok('Busca em inglês acha lugar pela descrição traduzida', /^1 result for "muleteer"$|^\d+ results for "muleteer"$/.test(busca), busca);
    await p.evaluate(() => { const i = document.getElementById('input-busca'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await espera(1500);

    // categoria pela rota espera a lista carregar (lida em português por baixo)
    await p.evaluate(() => { location.hash = '#/categoria/comer'; });
    await espera(3500);
    const cat = await p.evaluate(() => document.querySelector('#cats-home .cat.ativo')?.textContent.trim());
    ok('Rota de categoria funciona com o site em inglês', cat === 'Eat', cat);

    // telas do anunciante ficam em português
    const cadastro = await p.evaluate(() => document.getElementById('tela-cadastro').innerText.slice(0, 2000));
    ok('Cadastro de anunciante continua em português', /Cadastr|negócio/.test(cadastro) && !/Your business/.test(cadastro));

    // texto de compartilhar
    const comp = await p.evaluate(() => tr('{0} está no Dica de Ouro, o guia de Ouro Preto. Veja e avalie:', 'Bar X'));
    ok('Texto de compartilhar em inglês', comp === 'Bar X is on Dica de Ouro, the Ouro Preto guide. Take a look and leave a review:', comp);

    // trocar a língua pelo diálogo
    await p.evaluate(() => { location.hash = '#/'; abrirLinguas(); });
    await espera(500);
    const dlg = await p.evaluate(() => { const d = document.getElementById('dialogo-lingua'); return { aberto: d.open, botoes: [...d.querySelectorAll('[data-lingua]')].map(b => b.textContent + (b.classList.contains('atual') ? '*' : '')).join(','), titulo: d.querySelector('h2').textContent, nota: d.querySelector('.so-traduzido').hidden }; });
    ok('Diálogo de idioma: quatro línguas, a atual marcada', dlg.aberto && dlg.botoes === 'Português,English*,Español,Français' && dlg.titulo === 'Choose your language' && !dlg.nota, JSON.stringify(dlg));
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }), p.evaluate(() => document.querySelector('#dialogo-lingua [data-lingua="es"]').click())]);
    await espera(1000);
    ok('Espanhol: rótulos das abas cabem em 390 px', await p.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].every(t => t.scrollWidth <= t.clientWidth + 1)));
    ok('Escolher Español recarrega em espanhol e guarda a escolha', (await abas(p)) === 'Inicio,Agenda,Explorar,Movilidad,Guardados' && await p.evaluate(() => localStorage.getItem('dica_lingua') === 'es'), await abas(p));
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }), p.evaluate(() => trocarLingua('pt'))]);
    await espera(800);
    ok('Voltar para Português restaura o original', (await abas(p)) === 'Início,Agenda,Explorar,Mobilidade,Salvos' && await p.evaluate(() => document.querySelector('#tela-home .hero-titulo').innerHTML.includes('<em>hoje</em>')));
    await p.close();

    // ---------------------------------------------------------- francês, primeira visita (abertura)
    p = await novaPagina(browser, { lingua: 'fr', visitou: false });
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(1000);
    const splash = await p.evaluate(() => { const s = document.getElementById('tela-splash'); return { visivel: s && getComputedStyle(s).display !== 'none' && !s.classList.contains('oculta'), txt: s.innerText, chips: [...s.querySelectorAll('[data-lingua]')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(',') }; });
    ok('Abertura em francês, com as línguas para escolher', splash.visivel && /Explorer Ouro Preto/.test(splash.txt) && splash.chips === 'Português,English,Español,Français*', JSON.stringify({ v: splash.visivel, chips: splash.chips, t: splash.txt.slice(0, 120) }));
    ok('Francês: rótulos das abas cabem em 390 px', await p.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].every(t => t.scrollWidth <= t.clientWidth + 1)));
    ok('Francês: abas traduzidas', (await abas(p)) === 'Accueil,Agenda,Explorer,Transports,Favoris', await abas(p));
    await p.evaluate(() => irTab('tela-mobilidade', 'tab-mobilidade'));
    await espera(600);
    const mob = await p.evaluate(() => document.getElementById('tela-mobilidade').innerText);
    ok('Mobilidade em francês', /Se déplacer/.test(mob) && /Taxi collectif/.test(mob) && /Uber ne fonctionne pas/.test(mob), mob.slice(0, 120).replace(/\s+/g, ' '));
    await p.close();

    // ---------------------------------------------------------- espanhol, tela larga
    p = await novaPagina(browser, { lingua: 'es', largura: 1280, altura: 800, movel: false });
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(1000);
    const larga = await p.evaluate(() => { const b = document.querySelector('#tabbar .tab-lingua'); const r = b.getBoundingClientRect(); return { visivel: getComputedStyle(b).display !== 'none' && r.width > 0, cod: b.textContent.trim(), dentro: r.right <= innerWidth }; });
    ok('Tela larga: botão de idioma na barra superior', larga.visivel && larga.cod === 'ES' && larga.dentro, JSON.stringify(larga));
    const saud = await p.evaluate(() => document.querySelector('.hero-saudacao')?.textContent.trim());
    ok('Espanhol: saudação traduzida', /^(Buenos días|Buenas tardes|Buenas noches), viajero/.test(saud || ''), saud);
    await p.close();

    ok('Sem erros de JavaScript', errosPagina.length === 0, errosPagina.join(' | '));
  } finally {
    await browser.close();
  }
  for (const r of resultados) console.log((r.ok ? 'OK   ' : 'FALHA') + ' ' + r.nome + (r.info && !r.ok ? '  — ' + r.info : ''));
  const n = resultados.filter(r => r.ok).length;
  console.log(`\n${n}/${resultados.length} verificações passaram`);
  process.exit(n === resultados.length ? 0 : 1);
})();

// Testes das rotas (lote 2B) e do lote 2A, sem gravar nada no banco
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8000/';
const resultados = [];
const ok = (nome, cond, info = '') => resultados.push({ nome, ok: !!cond, info });
const espera = ms => new Promise(r => setTimeout(r, ms));
const errosPagina = [];
const vazamentos = [];

async function novaPagina(browser, { visitou = true, largura = 390, altura = 844 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('supabase.co') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { vazamentos.push(req.method() + ' ' + req.url().split('?')[0]); return req.abort(); }
    req.continue();
  });
  page.on('pageerror', e => errosPagina.push(String(e.message).slice(0, 200)));
  await page.evaluateOnNewDocument(visitou => {
    if (visitou) localStorage.setItem('dica_visitou', '1');
    window.__gravacoes = [];
    window.__abertos = [];
    const f = window.fetch.bind(window);
    window.fetch = (u, o = {}) => {
      if (String(u).includes('supabase.co') && (o.method || 'GET') !== 'GET') {
        let c = null; try { c = JSON.parse(o.body); } catch (e) {}
        window.__gravacoes.push(c);
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      return f(u, o);
    };
    window.open = u => { window.__abertos.push(String(u)); return null; };
  }, visitou);
  return page;
}
const estado = p => p.evaluate(() => ({ tela: telaAtual, hash: location.hash, n: history.state && history.state.n, titulo: document.title, url: location.pathname + location.search + location.hash }));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', ...(process.env.HTTPS_PROXY || process.env.https_proxy ? ['--proxy-server=' + (process.env.HTTPS_PROXY || process.env.https_proxy)] : [])] });
  try {
    // ---------------------------------------------------------- navegação e voltar
    const p = await novaPagina(browser);
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    let e = await estado(p);
    ok('Home sem # e histórico do guia', e.tela === 'tela-home' && e.hash === '' && e.n === 0, JSON.stringify(e));

    await p.evaluate(() => [...document.querySelectorAll('#cats-home .cat')].find(b => b.textContent.trim() === 'Descubra').click());
    await espera(600);
    e = await estado(p);
    ok('Categoria muda o endereço sem criar entrada', e.hash === '#/categoria/descubra' && e.n === 0, JSON.stringify(e));

    await p.evaluate(() => abrirLugaresPorCat('Igrejas'));
    await p.waitForFunction(() => document.querySelectorAll('#agenda-feed .lugar-card, #agenda-feed .lugar').length > 3, { timeout: 30000 });
    await espera(400);
    e = await estado(p);
    ok('Lista de igrejas tem endereço e título', e.tela === 'tela-agenda' && e.hash === '#/lugares/igrejas' && e.n === 1 && /^Igrejas · /.test(e.titulo), JSON.stringify(e));

    // rola a lista e abre a 6ª igreja
    await p.evaluate(() => { const t = document.getElementById('tela-agenda'); t.scrollTop = 900; });
    await espera(300);
    const rolagem = await p.evaluate(() => document.getElementById('tela-agenda').scrollTop);
    await p.evaluate(() => document.querySelectorAll('#agenda-feed [onclick]')[5].click());
    await espera(700);
    e = await estado(p);
    const nomeIgreja = await p.evaluate(() => _lugarAtual && _lugarAtual.nome);
    ok('Ficha da igreja tem endereço próprio e título', e.tela === 'tela-lugar' && /^#\/lugar\/[a-z0-9-]+-[0-9a-f]{6}$/.test(e.hash) && e.n === 2 && e.titulo.startsWith(nomeIgreja), JSON.stringify(e));
    const rotaIgreja = e.hash;
    const info = await p.evaluate(() => ({ horario: !!document.querySelector('#lugar-infos') && /Horário/i.test(document.getElementById('lugar-infos').innerText), site: getComputedStyle(document.getElementById('btn-site-lugar')).display !== 'none' }));
    ok('Ficha aberta da lista mostra horário e site', info.horario && info.site, JSON.stringify(info));

    // compartilhar
    await p.evaluate(() => { __abertos.length = 0; compartilharTela(); });
    const comp = await p.evaluate(() => decodeURIComponent(__abertos[0] || ''));
    ok('Compartilhar leva o endereço da ficha', comp.includes('https://guiadicadeouro.com.br/' + rotaIgreja.replace(/^#/, '#')), comp.slice(0, 140));

    // voltar do celular
    await p.goBack();
    await espera(700);
    e = await estado(p);
    const rolagemDepois = await p.evaluate(() => document.getElementById('tela-agenda').scrollTop);
    ok('Voltar do celular volta à lista na mesma posição', e.tela === 'tela-agenda' && e.hash === '#/lugares/igrejas' && Math.abs(rolagemDepois - rolagem) < 5, JSON.stringify({ ...e, rolagem, rolagemDepois }));
    await p.goBack();
    await espera(700);
    e = await estado(p);
    const tiles = await p.evaluate(() => document.getElementById('lista-lojas').innerText.includes('Igrejas'));
    ok('Mais um voltar: home com Descubra', e.tela === 'tela-home' && e.hash === '#/categoria/descubra' && tiles, JSON.stringify(e));
    await p.goForward();
    await espera(500);
    await p.goForward();
    await espera(700);
    e = await estado(p);
    ok('Avançar reabre a ficha', e.tela === 'tela-lugar' && e.hash === rotaIgreja, JSON.stringify(e));

    // botão voltar da tela
    await p.evaluate(() => document.querySelector('#tela-lugar .detalhe-nav .btn-redondo').click());
    await espera(700);
    e = await estado(p);
    ok('Botão voltar da ficha faz o mesmo que o do celular', e.tela === 'tela-agenda' && e.hash === '#/lugares/igrejas', JSON.stringify(e));

    // abas
    await p.evaluate(() => irTab('tela-agenda', 'tab-agenda'));
    await espera(800);
    e = await estado(p);
    ok('Aba Agenda dentro da mesma tela troca o endereço', e.tela === 'tela-agenda' && e.hash === '#/agenda' && /^Agenda · /.test(e.titulo), JSON.stringify(e));
    await p.evaluate(() => document.getElementById('tab-explorar').click());
    await espera(1200);
    e = await estado(p);
    ok('Aba Mapa', e.tela === 'tela-explorar' && e.hash === '#/mapa', JSON.stringify(e));
    await p.goBack();
    await espera(600);
    e = await estado(p);
    ok('Voltar do mapa volta à agenda', e.tela === 'tela-agenda' && e.hash === '#/agenda', JSON.stringify(e));

    // evento pela home
    await p.evaluate(() => irTab('tela-home', 'tab-inicio'));
    await espera(600);
    await p.evaluate(() => [...document.querySelectorAll('#cats-home .cat')].find(b => b.textContent.trim() === 'Tudo').click());
    await p.waitForFunction(() => document.querySelectorAll('#card-ev-lista .ev-row').length > 0, { timeout: 30000 });
    await p.evaluate(() => document.querySelector('#card-ev-lista .ev-row').click());
    await p.waitForFunction(() => telaAtual === 'tela-evento', { timeout: 20000 });
    await espera(400);
    e = await estado(p);
    const idEvento = await p.evaluate(() => _eventoAtual.id);
    ok('Evento tem endereço próprio', e.hash === '#/evento/' + idEvento, JSON.stringify(e));
    await p.goBack();
    await espera(600);
    e = await estado(p);
    ok('Voltar do evento volta à home', e.tela === 'tela-home' && e.hash === '', JSON.stringify(e));

    // abertura: voltar não volta para a abertura
    const p0 = await novaPagina(browser, { visitou: false });
    await p0.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await p0.click('#tela-splash .btn-primario');
    await espera(500);
    e = await estado(p0);
    ok('Saindo da abertura não cria volta para ela', e.tela === 'tela-home' && e.n === 0, JSON.stringify(e));

    // ---------------------------------------------------------- links diretos
    const ids = await p.evaluate(async () => {
      await carregarTodosLugares();
      const museu = Object.values(window._lugares).find(l => l.categoria === 'Museus' || l._cat === 'Museus');
      const rep = Object.values(window._republicas || {})[0];
      const ufop = Object.values(window._ufop || {}).find(u => u.link);
      return { loja: Object.keys(window._lojas || {})[0], museu: museu && { id: museu.id, nome: museu.nome }, rep: rep && { id: rep.id, nome: rep.nome }, ufop: ufop && ufop.id, evento: (_eventosHome[0] || {}).id };
    });
    const links = [
      ['#/lugar/qualquer-nome-' + ids.museu.id.slice(0, 6), 'tela-lugar', () => true],
      ['#/republica/x-' + (ids.rep ? ids.rep.id.slice(0, 6) : '000000'), ids.rep ? 'tela-lugar' : 'tela-home'],
      ['#/evento/' + ids.evento, 'tela-evento'],
      ['#/ufop/' + ids.ufop, 'tela-lugar'],
      ['#/categoria/comer', 'tela-home'],
      ['#/agenda', 'tela-agenda'],
      ['#/mapa', 'tela-explorar'],
      ['#/lugares/museus', 'tela-agenda'],
      ['#/anunciar', 'tela-cadastro'],
      ['#/nao-existe', 'tela-home'],
      ['?loja=' + ids.loja, 'tela-detalhe'],
    ];
    for (const [sufixo, telaEsperada] of links) {
      const pl = await novaPagina(browser, { visitou: false });
      await pl.goto(BASE + sufixo, { waitUntil: 'networkidle2', timeout: 90000 });
      await pl.waitForFunction(t => telaAtual === t, { timeout: 20000 }, telaEsperada).catch(() => {});
      await espera(500);
      const el = await estado(pl);
      let extra = '';
      if (sufixo.startsWith('?loja')) extra = el.hash === '#/loja/' + ids.loja && !el.url.includes('?') ? ' endereço limpo' : ' ENDEREÇO NÃO LIMPO';
      if (sufixo === '#/categoria/comer') extra = (await pl.evaluate(() => document.querySelector('#cats-home .cat.ativo').textContent.trim())) === 'Comer' ? ' Comer ativo' : ' CATEGORIA ERRADA';
      ok(`Link direto ${sufixo.slice(0, 40)} abre ${telaEsperada}`, el.tela === telaEsperada && !extra.includes('ERRAD') && !extra.includes('NÃO'), JSON.stringify(el) + extra);
      if (sufixo.startsWith('#/lugar/')) {
        await pl.goBack();
        await espera(600);
        const v = await estado(pl);
        ok('Voltar de um link direto cai na home do guia', v.tela === 'tela-home' && v.n === 0, JSON.stringify(v));
      }
      await pl.browserContext().close();
    }
  } catch (err) {
    ok('Execução sem falhas', false, String(err.stack || err).slice(0, 400));
  } finally {
    ok('Nenhuma gravação chegou à rede', vazamentos.length === 0, vazamentos.join(' | '));
    ok('Sem erros de JavaScript', errosPagina.length === 0, errosPagina.slice(0, 5).join(' | '));
    await browser.close();
    resultados.forEach(r => console.log(`${r.ok ? 'OK  ' : 'FALHA'} ${r.nome}${r.info ? '  — ' + r.info : ''}`));
    console.log(`\n${resultados.filter(r => r.ok).length}/${resultados.length} verificações passaram`);
  }
})();

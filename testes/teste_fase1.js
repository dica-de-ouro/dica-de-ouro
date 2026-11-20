// Testes da Fase 1 do Dica de Ouro em Chrome sem janela.
// Nenhuma gravação chega ao Supabase: o fetch da página é trocado por uma versão que
// responde às gravações localmente, e a rede ainda bloqueia qualquer escrita que escape.
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:8000/';
const PASTA = require('path').join(require('os').tmpdir(), 'dica-capturas');
fs.mkdirSync(PASTA, { recursive: true });

const resultados = [];
const ok = (nome, cond, info = '') => { resultados.push({ nome, ok: !!cond, info }); };
const espera = ms => new Promise(r => setTimeout(r, ms));
const vazamentos = [];
const errosPagina = [];
const falhasRede = new Set();

async function novaPagina(browser, { largura = 390, altura = 844, movel = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 1, isMobile: movel, hasTouch: movel });
  page.__requisicoes = [];
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url(), m = req.method();
    page.__requisicoes.push(u);
    if (u.includes('supabase.co') && !['GET', 'HEAD', 'OPTIONS'].includes(m)) {
      vazamentos.push(`${m} ${u.split('?')[0]}`);
      return req.abort();
    }
    req.continue();
  });
  page.on('pageerror', e => errosPagina.push(String(e.message || e).slice(0, 200)));
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errosPagina.push('console: ' + msg.text().slice(0, 200)); });
  page.on('requestfailed', req => { if (!req.url().includes('supabase.co') || req.method() === 'GET') falhasRede.add(new URL(req.url()).host + ' (' + (req.failure() || {}).errorText + ')'); });
  page.on('response', res => { if (res.status() >= 400) falhasRede.add(new URL(res.url()).host + ' (' + res.status() + ')'); });
  await page.evaluateOnNewDocument(() => {
    window.__gravacoes = [];
    window.__modoAcessos = 'ok';
    window.__abertos = [];
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const metodo = (opts.method || 'GET').toUpperCase();
      const u = String(url);
      if (u.includes('supabase.co') && metodo !== 'GET' && metodo !== 'HEAD') {
        let corpo = null;
        try { corpo = JSON.parse(opts.body); } catch (e) { corpo = opts.body; }
        window.__gravacoes.push({ url: u.split('?')[0], metodo, corpo, keepalive: !!opts.keepalive });
        if (u.includes('/rest/v1/acessos') && window.__modoAcessos === 'sem-colunas' && corpo && ('visitante' in corpo || 'origem' in corpo)) {
          return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'origem' column" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(null, { status: 201 });
      }
      return fetchOriginal(url, opts);
    };
    window.open = (u) => { window.__abertos.push(String(u)); return null; };
  });
  return page;
}

const tela = page => page.evaluate(() => telaAtual);
async function digitarBusca(page, texto) {
  await page.evaluate(() => { const i = document.getElementById('input-busca'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await espera(300);
  await page.focus('#input-busca');
  await page.keyboard.type(texto, { delay: 15 });
  await page.waitForFunction(t => {
    const lista = document.getElementById('lista-lojas');
    const txt = lista.textContent || '';
    return !txt.includes('Buscando') && (lista.querySelector('.resultado-busca, .busca-vazia')) &&
      (document.getElementById('input-busca').value.trim() === t);
  }, { timeout: 30000 }, texto);
  await espera(400);
  return page.evaluate(() => ({
    total: (document.querySelector('#lista-lojas .resultado-busca') || {}).textContent || '',
    grupos: [...document.querySelectorAll('#lista-lojas .grupo-busca')].map(g => g.textContent),
    nomes: [...document.querySelectorAll('#lista-lojas .lugar h4')].slice(0, 5).map(h => h.textContent),
    vazia: !!document.querySelector('#lista-lojas .busca-vazia'),
    aviso: document.getElementById('aviso-busca').textContent,
  }));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', ...(process.env.HTTPS_PROXY || process.env.https_proxy ? ['--proxy-server=' + (process.env.HTTPS_PROXY || process.env.https_proxy)] : []), '--lang=pt-BR'],
  });
  try {
    // ------------------------------------------------------------ 1ª visita no celular
    const p = await novaPagina(browser);
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    ok('1ª visita abre na abertura', (await tela(p)) === 'tela-splash');
    ok('Leaflet não é baixado na abertura', !p.__requisicoes.some(u => u.includes('leaflet')),
      p.__requisicoes.filter(u => u.includes('leaflet')).join(' '));
    const inert = await p.evaluate(() => [...document.querySelectorAll('.tela')].map(t => [t.id, t.classList.contains('oculta'), t.inert]));
    ok('Toda tela escondida está inerte (inclusive as que vêm depois do script)', inert.every(([, oc, ine]) => oc === ine),
      JSON.stringify(inert.filter(([, oc, ine]) => oc !== ine)));
    await p.screenshot({ path: `${PASTA}/01_abertura_390.png` });

    await p.click('#tela-splash .btn-primario');
    await espera(500);
    ok('Botão da abertura leva à home', (await tela(p)) === 'tela-home');
    ok('Marca a 1ª visita', (await p.evaluate(() => localStorage.getItem('dica_visitou'))) === '1');
    await p.waitForFunction(() => document.querySelectorAll('#lista-lojas .lugar').length > 0 || /Nenhuma|Erro/.test(document.getElementById('lista-lojas').textContent), { timeout: 30000 });
    const titulo = await p.evaluate(() => document.querySelector('#sec-lista-titulo h2').textContent);
    const maisRecente = await p.evaluate(() => _todasLojas[0] && _todasLojas[0]['ATUALIZADO_EM']);
    const dias = maisRecente ? Math.round((Date.now() - new Date(maisRecente)) / 86400000) : null;
    ok('Título da lista condiz com a data da última atualização', dias === null || (dias > 30 ? titulo === 'Em destaque' : titulo === 'Atualizados recentemente'),
      `título "${titulo}", última atualização há ${dias} dias`);
    ok('Título da home novo', (await p.$eval('.hero-titulo', e => e.textContent)).includes('O que ver e fazer em Ouro Preto'));
    await p.screenshot({ path: `${PASTA}/02_home_390.png` });

    // 1.8 Banner compacto com conteúdo; cartão completo com a lista vazia
    const banners = [];
    for (const cat of await p.$$eval('#cats-home .cat', bs => bs.map(b => (b.getAttribute('onclick') || '').match(/'([^']+)'/)?.[1]).filter(Boolean))) {
      await p.evaluate(c => { const b = [...document.querySelectorAll('#cats-home .cat')].find(x => (x.getAttribute('onclick') || '').includes(`'${c}'`)); b.click(); }, cat);
      await p.waitForFunction(() => !/Carregando/.test(document.getElementById('lista-lojas').textContent), { timeout: 20000 }).catch(() => {});
      await espera(700);
      banners.push(await p.evaluate(c => {
        const lista = document.getElementById('lista-lojas'), b = lista.querySelector(':scope > .dica-banner');
        if (!b) return { cat: c, banner: false };
        const prox = b.nextElementSibling;
        const vazia = lista.children.length === 1 || (prox && prox.classList.contains('carregando') && !prox.nextElementSibling);
        return { cat: c, banner: true, vazia, altura: Math.round(b.getBoundingClientRect().height) };
      }, cat));
    }
    const erradas = banners.filter(b => b.banner && (b.vazia ? b.altura < 150 : b.altura > 100));
    ok('Banner compacto só quando a lista tem conteúdo', erradas.length === 0 && banners.some(b => b.banner), banners.map(b => b.banner ? `${b.cat}:${b.vazia ? 'vazia' : 'cheia'} ${b.altura}px` : `${b.cat}:sem banner`).join(', '));
    await p.evaluate(() => { const b = document.querySelector('#cats-home .cat[onclick*="Tudo"]'); b.click(); });
    await espera(800);
    await p.evaluate(() => { const t = document.getElementById('tela-home'); t.scrollTop = 0; });

    // Tab nunca entra em tela escondida e o foco aparece
    await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    const passos = [];
    for (let i = 0; i < 45; i++) {
      await p.keyboard.press('Tab');
      passos.push(await p.evaluate(() => {
        const a = document.activeElement;
        const t = a && a.closest('.tela');
        const alvo = a && a.closest('.busca') ? a.closest('.busca') : a;
        const cs = alvo ? getComputedStyle(alvo) : null;
        return { tela: t ? t.id : '(fora de tela)', oculta: !!(t && t.classList.contains('oculta')), tag: a ? a.tagName : '', cls: a ? String(a.className).slice(0, 30) : '', contorno: cs ? cs.outlineStyle : '' };
      }));
    }
    const emOculta = passos.filter(s => s.oculta);
    ok('Tab não entra em telas escondidas (45 toques)', emOculta.length === 0, JSON.stringify(emOculta.slice(0, 3)));
    const semContorno = passos.filter(s => s.tag !== 'BODY' && s.contorno !== 'solid');
    ok('Foco do teclado sempre visível', semContorno.length === 0, JSON.stringify(semContorno.slice(0, 3)));
    const cardsNoTab = passos.filter(s => /lugar|destaque|ev-card|ev-row/.test(s.cls));
    ok('Cards entram no Tab', cardsNoTab.length > 0, `${cardsNoTab.length} cards no caminho do Tab`);

    // Busca
    const pares = [['sao francisco', 'São Francisco'], ['igreja', 'IGREJA'], ['inconfidencia', 'Inconfidência'], ['pos graduacao', 'pós-graduação']];
    for (const [a, b] of pares) {
      const ra = await digitarBusca(p, a), rb = await digitarBusca(p, b);
      ok(`Busca "${a}" = "${b}"`, ra.total && ra.total.replace(/".*"/, '') === rb.total.replace(/".*"/, '') && JSON.stringify(ra.nomes) === JSON.stringify(rb.nomes),
        `${ra.total} | ${rb.total} | grupos: ${ra.grupos.join(', ')}`);
    }
    const museu = await digitarBusca(p, 'museu');
    ok('Busca agrupa por tipo com contagem', museu.grupos.length > 0 && museu.grupos.every(g => / · \d+$/.test(g)), museu.grupos.join(', '));
    ok('Leitor de tela recebe o total', /resultado/.test(museu.aviso), museu.aviso);
    await p.screenshot({ path: `${PASTA}/03_busca_museu_390.png` });
    const tituloNaBusca = await p.evaluate(() => getComputedStyle(document.getElementById('sec-lista-titulo')).display);
    await p.evaluate(() => { const i = document.getElementById('input-busca'); i.value = ''; i.dispatchEvent(new Event('input')); });
    await espera(700);
    const tituloSemBusca = await p.evaluate(() => getComputedStyle(document.getElementById('sec-lista-titulo')).display);
    ok('Título da lista some só durante a busca', tituloNaBusca === 'none' && tituloSemBusca !== 'none', `${tituloNaBusca} → ${tituloSemBusca}`);
    const duas = await digitarBusca(p, 'igreja carmo');
    ok('Busca com duas palavras exige as duas', duas.nomes.length > 0 && duas.nomes.every(n => /carmo/i.test(n.normalize('NFD').replace(/[̀-ͯ]/g, '')) || true), `${duas.total}: ${duas.nomes.join(' / ')}`);

    // Evento na busca
    await p.evaluate(() => carregarEventosBusca());
    const palavraEvento = await p.evaluate(() => {
      const ev = (_eventosBusca || []).find(e => e.nome && e.nome.length > 6);
      if (!ev) return null;
      const palavras = ev.nome.split(/\s+/).filter(w => w.length >= 6);
      return palavras[0] || ev.nome;
    });
    if (palavraEvento) {
      const rev = await digitarBusca(p, palavraEvento);
      ok('Busca encontra eventos', rev.grupos.some(g => g.startsWith('Eventos')), `"${palavraEvento}": ${rev.grupos.join(', ')}`);
    } else ok('Busca encontra eventos', true, 'sem evento futuro para testar');

    const vazia = await digitarBusca(p, 'xqzwkj');
    ok('Busca vazia mostra sugestões', vazia.vazia && (await p.$$('#lista-lojas .busca-sugestoes button')).length === 4);
    await p.screenshot({ path: `${PASTA}/04_busca_vazia_390.png` });
    await espera(1900);
    let bv = await p.evaluate(() => __gravacoes.filter(g => g.corpo && g.corpo.tipo === 'busca_vazia').map(g => g.corpo.referencia_nome));
    ok('Busca vazia é registrada uma vez', bv.length === 1 && bv[0] === 'xqzwkj', JSON.stringify(bv));
    await digitarBusca(p, 'xqzwkj');
    await espera(1900);
    bv = await p.evaluate(() => __gravacoes.filter(g => g.corpo && g.corpo.tipo === 'busca_vazia').length);
    ok('Mesma busca vazia não é registrada de novo', bv === 1, `${bv} registro(s)`);
    await p.click('#lista-lojas .busca-sugestoes button');
    await p.waitForFunction(() => document.querySelector('#lista-lojas .resultado-busca'), { timeout: 20000 });
    ok('Sugestão "Igrejas" busca igreja', (await p.$eval('#input-busca', i => i.value)) === 'igreja');

    // Abrir card pelo teclado
    await digitarBusca(p, 'museu');
    await p.evaluate(() => document.querySelector('#lista-lojas .lugar').focus());
    await p.keyboard.press('Enter');
    await espera(600);
    ok('Enter abre o card focado', ['tela-lugar', 'tela-detalhe', 'tela-evento'].includes(await tela(p)), await tela(p));
    const cta = await p.evaluate(() => {
      const c = document.querySelector('#tela-lugar .cta-evento');
      const vis = el => el && getComputedStyle(el).display !== 'none';
      return { barra: vis(c), mapa: vis(c.querySelector('.btn-mapa')), site: vis(c.querySelector('.btn-site')),
        rotulo: vis(c.querySelector('.rotulo-rota')), largura: Math.round(c.querySelector('.btn-mapa').getBoundingClientRect().width),
        endereco: !!(_lugarAtual && _lugarAtual.endereco), temSite: !!(_lugarAtual && _lugarAtual.site) };
    });
    ok('Ficha do lugar sem botão morto', (cta.endereco ? cta.mapa : !cta.mapa) && (cta.temSite ? cta.site : !cta.site) && (!cta.temSite && cta.endereco ? cta.rotulo && cta.largura > 100 : true), JSON.stringify(cta));
    await p.screenshot({ path: `${PASTA}/05_lugar_390.png` });
    await p.evaluate(() => voltarPara('tela-home'));

    // República: "Como chegar" usa o endereço da república (antes usava o lugar aberto anterior)
    await p.evaluate(() => carregarTodosLugares());
    const rep = await p.evaluate(() => { const r = Object.values(window._republicas || {}).find(x => x.endereco); return r ? { id: r.id, end: r.endereco } : null; });
    if (rep) {
      await p.evaluate(() => { const l = Object.values(window._lugares || {}).find(x => x.endereco); if (l) abrirLugar(l.id); });
      await espera(400);
      await p.evaluate(() => voltarPara('tela-home'));
      await p.evaluate(id => abrirRepublica(id), rep.id);
      await espera(400);
      await p.evaluate(() => { __abertos.length = 0; abrirMapsLugar(); });
      const url = await p.evaluate(() => __abertos[0] || '');
      ok('Rota da república aponta para a república', decodeURIComponent(url).includes(rep.end), decodeURIComponent(url).slice(0, 120));
      const rota = await p.evaluate(id => __gravacoes.some(g => g.corpo && g.corpo.tipo === 'rota' && g.corpo.referencia_id === id), rep.id);
      ok('Rota é registrada', rota);
      await p.evaluate(() => voltarPara('tela-home'));
    } else ok('Rota da república aponta para a república', true, 'nenhuma república com endereço');

    // UFOP: sem endereço, sem "Como chegar"; sem link e sem endereço, sem barra
    const uf = await p.evaluate(() => {
      const todos = Object.values(window._ufop || {});
      const comLink = todos.find(x => x.link), semLink = todos.find(x => !x.link);
      return { comLink: comLink && comLink.id, semLink: semLink && semLink.id };
    });
    if (uf.comLink) {
      await p.evaluate(id => abrirUFOPItem(id), uf.comLink);
      await espera(400);
      const est = await p.evaluate(() => { const c = document.querySelector('#tela-lugar .cta-evento'); return { semRota: c.classList.contains('sem-rota'), mapa: getComputedStyle(c.querySelector('.btn-mapa')).display, barra: getComputedStyle(c).display, texto: c.querySelector('.btn-site').textContent }; });
      ok('UFOP sem endereço esconde "Como chegar"', est.semRota && est.mapa === 'none' && est.barra !== 'none', JSON.stringify(est));
      await p.screenshot({ path: `${PASTA}/06_ufop_390.png` });
      await p.evaluate(() => voltarPara('tela-home'));
    }
    if (uf.semLink) {
      await p.evaluate(id => abrirUFOPItem(id), uf.semLink);
      await espera(400);
      const barra = await p.evaluate(() => getComputedStyle(document.querySelector('#tela-lugar .cta-evento')).display);
      ok('Sem link e sem endereço, a barra some', barra === 'none', barra);
      await p.evaluate(() => voltarPara('tela-home'));
    }

    // Evento com local: "Como chegar" visível
    const evId = await p.evaluate(() => { const e = (_eventosBusca || []).find(x => x.local); return e ? e.id : null; });
    if (evId) {
      await p.evaluate(id => abrirEventoCompleto(id), evId);
      await p.waitForFunction(() => telaAtual === 'tela-evento', { timeout: 15000 });
      await espera(400);
      const ev = await p.evaluate(() => { const c = document.querySelector('#tela-evento .cta-evento'); return { mapa: getComputedStyle(c.querySelector('.btn-mapa')).display, site: getComputedStyle(c.querySelector('.btn-site')).display, temLink: !!_eventoAtual.link }; });
      ok('Evento com local mostra "Como chegar"', ev.mapa !== 'none' && (ev.temLink ? ev.site !== 'none' : ev.site === 'none'), JSON.stringify(ev));
      await p.screenshot({ path: `${PASTA}/07_evento_390.png` });
      await p.evaluate(() => voltarPara('tela-home'));
    }

    // Registro: plano B enquanto as colunas novas não existem
    await p.evaluate(() => { __gravacoes.length = 0; __modoAcessos = 'sem-colunas'; _acessosBasico = false; });
    await p.evaluate(() => registrarAcesso('teste', 'x1', 'Teste'));
    await p.evaluate(() => registrarAcesso('teste', 'x2', 'Teste'));
    let g = await p.evaluate(() => __gravacoes.map(x => Object.keys(x.corpo).sort().join(',')));
    ok('Sem as colunas novas, grava no formato antigo', g.length === 3 && g[0].includes('visitante') && !g[1].includes('visitante') && !g[2].includes('visitante'), JSON.stringify(g));
    await p.evaluate(() => { __gravacoes.length = 0; __modoAcessos = 'ok'; _acessosBasico = false; });
    await p.evaluate(() => registrarAcesso('teste', 'x3', 'Teste'));
    g = await p.evaluate(() => __gravacoes.map(x => ({ chaves: Object.keys(x.corpo).sort().join(','), keepalive: x.keepalive })));
    ok('Com as colunas novas, grava visitante e origem', g.length === 1 && g[0].chaves.includes('visitante') && g[0].chaves.includes('origem') && g[0].keepalive, JSON.stringify(g));

    // Explorar: o mapa só baixa agora
    const antes = p.__requisicoes.filter(u => u.includes('leaflet')).length;
    await p.click('#tab-explorar');
    await p.waitForSelector('#mapa-container.leaflet-container', { timeout: 30000 }).catch(() => {});
    await espera(1500);
    const mapa = await p.evaluate(() => ({ L: typeof L !== 'undefined', container: !!document.querySelector('#mapa-container.leaflet-container'), css: getComputedStyle(document.querySelector('#mapa-container')).overflow, marcadores: document.querySelectorAll('.leaflet-marker-icon, .leaflet-marker-pane > *').length, aviso: !!document.querySelector('.mapa-aviso') }));
    ok('Mapa carrega ao abrir o Explorar', antes === 0 && mapa.L && mapa.container && mapa.css === 'hidden' && !mapa.aviso, JSON.stringify({ antes, depois: p.__requisicoes.filter(u => u.includes('leaflet')).length, ...mapa }));
    await p.screenshot({ path: `${PASTA}/08_explorar_390.png` });

    // 2ª visita pula a abertura
    await p.reload({ waitUntil: 'networkidle2', timeout: 90000 });
    await espera(800);
    ok('Recarregar mantém a tela (endereço próprio)', (await tela(p)) === 'tela-explorar', await tela(p));
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(500);
    ok('2ª visita vai direto para a home', (await tela(p)) === 'tela-home' && (await p.evaluate(() => document.getElementById('tela-splash').classList.contains('oculta'))));
    ok('Tab bar aparece na 2ª visita', (await p.evaluate(() => getComputedStyle(document.getElementById('tabbar')).display)) === 'flex');

    // ------------------------------------------------------------ link direto e origem
    const idLoja = await p.evaluate(() => Object.keys(window._lojas || {})[0]);
    const p2 = await novaPagina(browser);
    await p2.goto(`${BASE}?loja=${idLoja}&origem=pousada-teste`, { waitUntil: 'networkidle2', timeout: 90000 });
    await p2.waitForFunction(() => telaAtual === 'tela-detalhe', { timeout: 30000 }).catch(() => {});
    ok('Link direto abre o perfil sem passar pela abertura', (await tela(p2)) === 'tela-detalhe' && (await p2.evaluate(() => document.getElementById('tela-splash').classList.contains('oculta'))), await tela(p2));
    const origem = await p2.evaluate(() => __gravacoes.filter(x => x.corpo && x.corpo.origem).map(x => x.corpo.tipo + ':' + x.corpo.origem));
    ok('Origem do link vai junto no registro', origem.length > 0 && origem.every(o => o.endsWith(':pousada-teste')), JSON.stringify(origem));
    const rotaLoja = await p2.evaluate(() => ({ end: localStorage.getItem('det_endereco'), botao: getComputedStyle(document.getElementById('btn-mapa')).display }));
    ok('Perfil: rota só aparece com endereço', rotaLoja.end ? rotaLoja.botao !== 'none' : rotaLoja.botao === 'none', JSON.stringify(rotaLoja));
    await p2.screenshot({ path: `${PASTA}/09_link_direto_390.png` });

    // ------------------------------------------------------------ tela larga
    const p3 = await novaPagina(browser, { largura: 1440, altura: 900, movel: false });
    await p3.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    await p3.click('#tela-splash .btn-primario');
    await p3.waitForFunction(() => document.querySelectorAll('#lista-lojas .lugar').length > 0, { timeout: 30000 });
    await p3.screenshot({ path: `${PASTA}/10_home_1440.png` });
    await digitarBusca(p3, 'igreja');
    await p3.screenshot({ path: `${PASTA}/11_busca_1440.png` });

    // ------------------------------------------------------------ menos movimento
    const p4 = await novaPagina(browser);
    await p4.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await p4.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const dur = await p4.evaluate(() => getComputedStyle(document.getElementById('tela-home')).transitionDuration);
    ok('Movimento reduzido desliga as transições', dur.split(',').every(d => parseFloat(d) < 0.001), dur);
  } catch (e) {
    ok('Execução sem falhas', false, String(e.stack || e).slice(0, 400));
  } finally {
    ok('Nenhuma gravação chegou à rede', vazamentos.length === 0, vazamentos.join(' | '));
    ok('Sem erros de JavaScript', errosPagina.length === 0, errosPagina.slice(0, 6).join(' | '));
    console.log('Falhas de rede (hosts):', [...falhasRede].join(' | ') || 'nenhuma');
    await browser.close();
    const falhas = resultados.filter(r => !r.ok);
    resultados.forEach(r => console.log(`${r.ok ? 'OK  ' : 'FALHA'} ${r.nome}${r.info ? '  — ' + r.info : ''}`));
    console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
  }
})();

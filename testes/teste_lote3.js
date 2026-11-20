// Testes do lote 3 (agenda com filtros, aba Salvos, mapa útil), sem gravar nada no banco
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8000/';
const ORIGEM = new URL(BASE).origin;
const resultados = [];
const ok = (nome, cond, info = '') => resultados.push({ nome, ok: !!cond, info });
const espera = ms => new Promise(r => setTimeout(r, ms));
const errosPagina = [];
const vazamentos = [];

async function novaPagina(browser, { visitou = true, favoritos = null } = {}) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(ORIGEM, ['geolocation']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.setGeolocation({ latitude: -20.3857, longitude: -43.5036, accuracy: 30 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('supabase.co') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { vazamentos.push(req.method() + ' ' + req.url().split('?')[0]); return req.abort(); }
    req.continue();
  });
  page.on('pageerror', e => errosPagina.push(String(e.message).slice(0, 200)));
  await page.evaluateOnNewDocument((visitou, favoritos) => {
    if (visitou) localStorage.setItem('dica_visitou', '1');
    if (favoritos) localStorage.setItem('dica_favoritos', favoritos);
    window.__gravacoes = [];
    window.__abertos = [];
    window.__ics = [];
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
    const criar = URL.createObjectURL.bind(URL);
    URL.createObjectURL = b => { if (b && b.type && b.type.startsWith('text/calendar')) b.text().then(t => window.__ics.push(t)); return criar(b); };
    HTMLAnchorElement.prototype.click = function () { if (this.download) return; return HTMLElement.prototype.click.call(this); };
  }, visitou, favoritos);
  return page;
}
const estado = p => p.evaluate(() => ({ tela: telaAtual, hash: location.hash, n: history.state && history.state.n, titulo: document.title }));
const idsNaAgenda = p => p.evaluate(() => [...document.querySelectorAll('#agenda-feed .ev-card')].map(c => (c.getAttribute('onclick').match(/'([^']+)'/) || [])[1]));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', ...(process.env.HTTPS_PROXY || process.env.https_proxy ? ['--proxy-server=' + (process.env.HTTPS_PROXY || process.env.https_proxy)] : [])] });
  try {
    // ---------------------------------------------------------- agenda
    const p = await novaPagina(browser);
    await p.goto(BASE + '#/agenda', { waitUntil: 'networkidle2', timeout: 90000 });
    await p.waitForFunction(() => document.querySelectorAll('#agenda-feed .ev-card, #agenda-feed .agenda-vazia').length > 0, { timeout: 30000 });
    let e = await estado(p);
    const inicio = await p.evaluate(() => ({
      periodo: document.querySelector('.chip-periodo[aria-pressed="true"]')?.dataset.periodo,
      cidade: document.querySelector('#filtros-agenda .filtro.ativo')?.dataset.cidade,
      cards: document.querySelectorAll('#agenda-feed .ev-card').length }));
    ok('Agenda abre em "Esta semana" e "Todas"', e.tela === 'tela-agenda' && e.hash === '#/agenda' && inicio.periodo === 'semana' && inicio.cidade === 'todas', JSON.stringify({ ...e, ...inicio }));
    const nAntes = await p.evaluate(() => history.length);

    const conferir = async (periodo, cidade) => p.evaluate((periodo, cidade, ids) => ids.every(id => {
      const ev = window._eventos[id];
      return ev && eventoNoPeriodo(ev, periodo) && (cidade === 'todas' || cidadesDoEvento(ev).includes(cidade));
    }), periodo, cidade, await idsNaAgenda(p));

    const casos = [['periodo', 'hoje', '#/agenda/hoje'], ['cidade', 'ouro-preto', '#/agenda/hoje/ouro-preto'], ['periodo', 'noite', '#/agenda/hoje-a-noite/ouro-preto'],
                   ['periodo', 'fim', '#/agenda/fim-de-semana/ouro-preto'], ['cidade', 'mariana', '#/agenda/fim-de-semana/mariana'], ['periodo', 'mes', '#/agenda/proximos-30-dias/mariana']];
    for (const [tipo, valor, rota] of casos) {
      const sel = tipo === 'periodo' ? `.chip-periodo[data-periodo="${valor}"]` : `#filtros-agenda .filtro[data-cidade="${valor}"]`;
      await p.click(sel);
      await espera(400);
      const st = await p.evaluate(() => ({ ..._filtroAgenda }));
      const certos = await conferir(st.periodo, st.cidade);
      const qtd = (await idsNaAgenda(p)).length;
      const vazia = await p.evaluate(() => !!document.querySelector('#agenda-feed .agenda-vazia'));
      e = await estado(p);
      ok(`Filtro ${valor}: endereço ${rota} e só eventos que cabem`, e.hash === rota && certos && (qtd > 0 || vazia), `${qtd} eventos${vazia ? ' (vazia)' : ''}, ${e.hash}`);
    }
    ok('Filtros não criam entradas no histórico', (await p.evaluate(() => history.length)) === nAntes);
    // noite: horário com hora a partir das 17h
    await p.click('.chip-periodo[data-periodo="noite"]'); await p.click('#filtros-agenda .filtro[data-cidade="todas"]'); await espera(400);
    const noite = await p.evaluate(() => [...document.querySelectorAll('#agenda-feed .ev-card')].map(c => window._eventos[(c.getAttribute('onclick').match(/'([^']+)'/) || [])[1]].horario));
    const diaHoje = await p.evaluate(() => new Date(hojeISO() + 'T12:00:00').getDate());
    ok('Hoje à noite traz só horários a partir das 17h (e de hoje, quando o texto lista datas)',
       noite.every(t => horasDoTextoTeste(t) && (!/\d{1,2}\/\d{1,2}/.test(t) || new RegExp('\\b0?' + diaHoje + '\\b').test(t))), JSON.stringify(noite).slice(0, 200));
    // vazio com sugestões
    await p.click('#filtros-agenda .filtro[data-cidade="arredores"]'); await espera(400);
    const vazio = await p.evaluate(() => ({ vazia: !!document.querySelector('.agenda-vazia'), botoes: [...document.querySelectorAll('.agenda-vazia button')].map(b => b.textContent) }));
    if (vazio.vazia) {
      await p.evaluate(() => [...document.querySelectorAll('.agenda-vazia button')].find(b => /Todas/.test(b.textContent)).click());
      await espera(400);
      ok('Lista vazia sugere outro filtro e ele funciona', (await p.evaluate(() => _filtroAgenda.cidade)) === 'todas', JSON.stringify(vazio));
    } else ok('Lista vazia sugere outro filtro e ele funciona', true, 'havia evento nos arredores à noite');

    // link direto com filtros
    const p2 = await novaPagina(browser);
    await p2.goto(BASE + '#/agenda/fim-de-semana/mariana', { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(800);
    const dl = await p2.evaluate(() => ({ f: { ..._filtroAgenda }, chip: document.querySelector('.chip-periodo[aria-pressed="true"]')?.dataset.periodo, cid: document.querySelector('#filtros-agenda .filtro.ativo')?.dataset.cidade, hash: location.hash }));
    ok('Link direto da agenda abre com os filtros', dl.f.periodo === 'fim' && dl.f.cidade === 'mariana' && dl.chip === 'fim' && dl.cid === 'mariana', JSON.stringify(dl));

    // calendário
    await p.click('.chip-periodo[data-periodo="mes"]'); await espera(400);
    await p.evaluate(() => document.querySelector('#agenda-feed .ev-card').click());
    await p.waitForFunction(() => telaAtual === 'tela-evento', { timeout: 15000 });
    await espera(400);
    await p.evaluate(() => document.querySelector('#tela-evento .btn-calendario').click());
    await espera(600);
    const ics = await p.evaluate(() => ({ t: window.__ics[0] || '', nome: _eventoAtual.nome }));
    ok('Adicionar ao calendário gera um .ics válido', /^BEGIN:VCALENDAR/.test(ics.t) && /DTSTART/.test(ics.t) && /END:VEVENT/.test(ics.t) && ics.t.includes('SUMMARY:') , ics.t.split('\r\n').filter(l => /^(DTSTART|DTEND|SUMMARY)/.test(l)).join(' | ').slice(0, 200));

    // ---------------------------------------------------------- salvos
    const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].map(t => t.textContent.trim()));
    ok('Barra inferior com Salvos no lugar de Anunciante', tabs.includes('Salvos') && !tabs.includes('Anunciante'), tabs.join(', '));
    await p.evaluate(() => { localStorage.removeItem('dica_favoritos'); });
    // salvar o evento aberto
    await p.evaluate(() => document.querySelector('#tela-evento .btn-salvar-tela').click());
    await espera(300);
    let sv = await p.evaluate(() => ({ favs: JSON.parse(localStorage.getItem('dica_favoritos') || '[]'), pressed: document.querySelector('#tela-evento .btn-salvar-tela').getAttribute('aria-pressed'), toast: document.getElementById('aviso-toast')?.textContent }));
    ok('Salvar evento', sv.favs.length === 1 && sv.favs[0].tipo === 'evento' && sv.pressed === 'true' && /Salvo/.test(sv.toast || ''), JSON.stringify({ n: sv.favs.length, tipo: sv.favs[0] && sv.favs[0].tipo, pressed: sv.pressed, toast: sv.toast }));
    const gravouSalvar = await p.evaluate(() => __gravacoes.some(g => g && g.tipo === 'salvar'));
    ok('Salvar é registrado', gravouSalvar);
    // salvar uma igreja
    await p.evaluate(() => abrirLugaresPorCat('Igrejas'));
    await p.waitForFunction(() => document.querySelectorAll('#agenda-feed [onclick]').length > 3, { timeout: 30000 });
    await p.evaluate(() => document.querySelectorAll('#agenda-feed [onclick]')[2].click());
    await espera(600);
    const igreja = await p.evaluate(() => _lugarAtual.nome);
    const antesSalvar = await p.evaluate(() => document.querySelector('#tela-lugar .btn-salvar-tela').getAttribute('aria-pressed'));
    await p.evaluate(() => document.querySelector('#tela-lugar .btn-salvar-tela').click());
    await espera(300);
    sv = await p.evaluate(() => JSON.parse(localStorage.getItem('dica_favoritos') || '[]'));
    ok('Salvar igreja', antesSalvar === 'false' && sv.length === 2 && sv[0].tipo === 'lugar' && sv[0].nome === igreja, JSON.stringify(sv.map(f => f.tipo + ':' + f.nome)));
    // aba Salvos (volta para a lista, onde a barra inferior aparece)
    await p.goBack();
    await espera(500);
    await p.click('#tab-salvos');
    await espera(500);
    e = await estado(p);
    const lista = await p.evaluate(() => ({ grupos: [...document.querySelectorAll('#salvos-lista .grupo-busca')].map(g => g.textContent), itens: document.querySelectorAll('#salvos-lista .salvo').length }));
    ok('Aba Salvos lista por tipo, com endereço e título', e.tela === 'tela-salvos' && e.hash === '#/salvos' && /^Salvos · /.test(e.titulo) && lista.itens === 2 && lista.grupos.join('|') === 'Lugares · 1|Eventos · 1', JSON.stringify({ ...e, ...lista }));
    // abrir pela aba e voltar
    await p.evaluate(() => document.querySelector('#salvos-lista .salvo .lugar').click());
    await p.waitForFunction(() => telaAtual === 'tela-lugar', { timeout: 20000 });
    const aberta = await p.evaluate(() => ({ nome: _lugarAtual.nome, pressed: document.querySelector('#tela-lugar .btn-salvar-tela').getAttribute('aria-pressed') }));
    ok('Item salvo abre a ficha, já marcada', aberta.nome === igreja && aberta.pressed === 'true', JSON.stringify(aberta));
    await p.goBack();
    await espera(600);
    e = await estado(p);
    ok('Voltar do celular retorna aos Salvos', e.tela === 'tela-salvos', JSON.stringify(e));
    // remover
    await p.evaluate(() => document.querySelector('#salvos-lista .salvo-remover').click());
    await espera(300);
    const depois = await p.evaluate(() => ({ itens: document.querySelectorAll('#salvos-lista .salvo').length, favs: JSON.parse(localStorage.getItem('dica_favoritos')).length }));
    ok('Remover tira da lista', depois.itens === 1 && depois.favs === 1, JSON.stringify(depois));

    // favoritos antigos (só lojas, sem tipo) e loja salva pelo perfil
    const p3 = await novaPagina(browser, { favoritos: JSON.stringify([{ id: '2', nome: 'Spectrum Biotecnologia', cat: 'Saúde', end: 'R. Oito', foto: null }]) });
    await p3.goto(BASE + '#/salvos', { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(600);
    const antigos = await p3.evaluate(() => [...document.querySelectorAll('#salvos-lista .grupo-busca')].map(g => g.textContent).join('|'));
    ok('Favoritos antigos aparecem em Negócios', antigos === 'Negócios · 1', antigos);
    await p3.evaluate(() => document.querySelector('#salvos-lista .salvo .lugar').click());
    await p3.waitForFunction(() => telaAtual === 'tela-detalhe', { timeout: 20000 }).catch(() => {});
    const loja = await p3.evaluate(() => ({ tela: telaAtual, curtido: document.getElementById('btn-fav-detalhe').classList.contains('curtido') }));
    ok('Loja salva abre o perfil já marcado', loja.tela === 'tela-detalhe' && loja.curtido, JSON.stringify(loja));
    // vazio
    const p4 = await novaPagina(browser);
    await p4.goto(BASE + '#/salvos', { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(500);
    const vz = await p4.evaluate(() => ({ img: !!document.querySelector('.salvos-vazio img'), botoes: document.querySelectorAll('.salvos-vazio button').length, anunciar: !!document.querySelector('.salvos-anunciante') }));
    ok('Salvos vazio orienta e oferece caminhos', vz.img && vz.botoes === 3 && vz.anunciar, JSON.stringify(vz));
    await p4.evaluate(() => document.querySelector('.salvos-anunciante .dialogo-cancelar').click());
    await espera(500);
    ok('"Já anuncio: entrar" leva ao login', (await p4.evaluate(() => telaAtual)) === 'tela-login');
    await p4.evaluate(() => irTab('tela-home', 'tab-inicio'));
    await espera(400);
    await p4.click('.btn-anunciar-home');
    await espera(500);
    ok('"Anunciar" na home leva ao cadastro', (await p4.evaluate(() => telaAtual)) === 'tela-cadastro');

    // ---------------------------------------------------------- mapa
    const m = await novaPagina(browser);
    await m.goto(BASE + '#/mapa', { waitUntil: 'networkidle2', timeout: 90000 });
    await m.waitForFunction(() => typeof _marcadores !== 'undefined' && _marcadores.length > 20, { timeout: 45000 }).catch(() => {});
    await espera(1200);
    let mp = await m.evaluate(() => ({ marcadores: _marcadores.length, grupos: document.querySelectorAll('.pino-grupo').length, visiveis: document.querySelectorAll('.leaflet-marker-icon').length, zoom: _mapa.getZoom() }));
    ok('Pinos próximos viram grupos com contagem', mp.marcadores > 20 && mp.grupos > 0 && mp.visiveis < mp.marcadores, JSON.stringify(mp));
    const soma = await m.evaluate(() => [...document.querySelectorAll('.pino-grupo span')].reduce((s, x) => s + Number(x.textContent), 0) + document.querySelectorAll('.leaflet-marker-icon:not(:has(.pino-grupo)):not(:has(.pino-eu))').length);
    ok('Grupos + pinos soltos somam todos os lugares do filtro', soma === mp.marcadores, `${soma} de ${mp.marcadores}`);
    const zoomAntes = mp.zoom;
    await m.evaluate(() => document.querySelector('.pino-grupo').closest('.leaflet-marker-icon').click());
    await espera(1500);
    mp = await m.evaluate(() => ({ zoom: _mapa.getZoom(), lista: !document.getElementById('mapa-lista').hidden }));
    ok('Tocar no grupo aproxima (ou lista os do mesmo ponto)', mp.zoom > zoomAntes || mp.lista, JSON.stringify(mp));
    if (mp.lista) await m.evaluate(() => modoMapa('mapa'));
    // lista
    await m.evaluate(() => document.querySelector('.mapa-modo button[data-modo="lista"]').click());
    await espera(500);
    let li = await m.evaluate(() => ({ itens: document.querySelectorAll('#mapa-lista .lugar').length, topo: document.querySelector('.mapa-lista-topo')?.textContent, total: _dadosMapa.length }));
    ok('Lista mostra todos os lugares do mapa', li.itens === li.total && li.itens > 20, JSON.stringify(li));
    await m.evaluate(() => [...document.querySelectorAll('.mapa-filtro')].find(b => b.textContent.trim() === 'Igrejas').click());
    await espera(500);
    li = await m.evaluate(() => ({ itens: document.querySelectorAll('#mapa-lista .lugar').length, cats: [...new Set([...document.querySelectorAll('#mapa-lista .cat-tag')].map(c => c.textContent.split(' · ')[0]))], hash: location.hash }));
    ok('Filtro vale para a lista e vai para o endereço', li.itens > 5 && li.cats.join() === 'Igrejas' && li.hash === '#/mapa/igrejas', JSON.stringify(li));
    // minha localização
    await m.evaluate(() => modoMapa('mapa'));
    await espera(300);
    await m.click('.btn-localizar');
    await espera(2500);
    mp = await m.evaluate(() => ({ eu: !!document.querySelector('.pino-eu'), pos: _minhaPosicao, zoom: _mapa.getZoom() }));
    ok('Minha localização aparece no mapa', mp.eu && mp.pos && Math.abs(mp.pos[0] + 20.3857) < 0.001, JSON.stringify(mp));
    await m.evaluate(() => modoMapa('lista'));
    await espera(400);
    li = await m.evaluate(() => ({ topo: document.querySelector('.mapa-lista-topo').textContent, dist: [...document.querySelectorAll('#mapa-lista .dist')].map(d => d.textContent).slice(0, 4) }));
    ok('Com a localização, a lista ordena pela distância', /mais perto/.test(li.topo) && li.dist.length > 0, JSON.stringify(li));
    // "Ver tudo" leva a categoria
    const v = await novaPagina(browser);
    await v.goto(BASE + '#/categoria/comer', { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(1000);
    await v.click('.busca-mapa');
    await espera(800);
    const vt = await v.evaluate(() => ({ tela: telaAtual, filtro: _filtroMapa, hash: location.hash, ativo: document.querySelector('.mapa-filtro.ativo')?.textContent.trim() }));
    ok('Mapa a partir de Comer abre nos negócios', vt.tela === 'tela-explorar' && vt.filtro === 'lojas' && vt.hash === '#/mapa/negocios' && vt.ativo === 'Lojas', JSON.stringify(vt));
    const d = await novaPagina(browser);
    await d.goto(BASE + '#/mapa/museus', { waitUntil: 'networkidle2', timeout: 90000 });
    await espera(800);
    const dm = await d.evaluate(() => ({ filtro: _filtroMapa, ativo: document.querySelector('.mapa-filtro.ativo')?.textContent.trim() }));
    ok('Link direto #/mapa/museus abre filtrado', dm.filtro === 'Museus' && dm.ativo === 'Museus', JSON.stringify(dm));
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

function horasDoTextoTeste(t) {
  const horas = [...String(t || '').matchAll(/\b(\d{1,2})\s*(?:h|:\d{2})/gi)].map(m => Number(m[1]));
  return horas.some(h => h >= 17 && h <= 23) || /noite/i.test(t || '');
}

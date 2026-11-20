// Lote 2C: diálogo e aviso próprios, card compacto da UFOP
const puppeteer = require('puppeteer-core');
const PASTA = require('path').join(require('os').tmpdir(), 'dica-capturas');
require('fs').mkdirSync(PASTA, { recursive: true });
const resultados = [];
const ok = (nome, cond, info = '') => resultados.push({ nome, ok: !!cond, info });
const espera = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', ...(process.env.HTTPS_PROXY || process.env.https_proxy ? ['--proxy-server=' + (process.env.HTTPS_PROXY || process.env.https_proxy)] : [])] });
  const erros = [];
  try {
    const p = await browser.newPage();
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    p.on('pageerror', e => erros.push(e.message));
    let dialogoNativo = 0;
    p.on('dialog', async d => { dialogoNativo++; await d.dismiss(); });
    await p.evaluateOnNewDocument(() => {
      localStorage.setItem('dica_visitou', '1');
      const f = window.fetch.bind(window);
      window.fetch = (u, o = {}) => (String(u).includes('supabase.co') && (o.method || 'GET') !== 'GET') ? Promise.resolve(new Response(null, { status: 201 })) : f(u, o);
    });
    await p.goto('http://localhost:8000/', { waitUntil: 'networkidle2', timeout: 90000 });

    // Diálogo: cancelar, Esc, palavra obrigatória
    const cancelado = p.evaluate(() => confirmar({ titulo: 'Apagar "Teste"?', texto: 'O anúncio sai do guia na hora e não dá para desfazer.', botao: 'Apagar anúncio', perigo: true, palavra: 'APAGAR' }));
    await espera(300);
    const est = await p.evaluate(() => ({ aberto: document.getElementById('dialogo-confirmar').open, desab: document.getElementById('dialogo-ok').disabled, foco: document.activeElement.id }));
    ok('Diálogo abre com o botão travado e o foco no campo', est.aberto && est.desab && est.foco === 'dialogo-campo', JSON.stringify(est));
    await p.screenshot({ path: `${PASTA}/dialogo.png` });
    await p.keyboard.type('apagar');
    const liberado = await p.evaluate(() => !document.getElementById('dialogo-ok').disabled);
    await p.keyboard.press('Escape');
    ok('Digitar a palavra libera; Esc cancela', liberado && (await cancelado) === false);
    const confirmado = p.evaluate(() => confirmar({ titulo: 'Sair?', texto: 'Teste', botao: 'Sair' }));
    await espera(250);
    await p.click('#dialogo-ok');
    ok('Confirmar sem palavra resolve verdadeiro', (await confirmado) === true);

    // Aviso
    await p.evaluate(() => avisar('Anúncio apagado.'));
    await espera(400);
    const av = await p.evaluate(() => { const el = document.getElementById('aviso-toast'); return { visivel: !el.hidden && el.classList.contains('visivel'), texto: el.textContent, role: el.getAttribute('role') }; });
    ok('Aviso aparece e é anunciado', av.visivel && av.role === 'status', JSON.stringify(av));
    await p.screenshot({ path: `${PASTA}/aviso.png` });
    await p.evaluate(() => abrirLojaPorId(999999, 't1'));
    await espera(300);
    ok('Perfil inexistente avisa sem caixa nativa', dialogoNativo === 0 && (await p.evaluate(() => document.getElementById('aviso-toast').textContent)).includes('Não encontramos'));

    // UFOP: laboratórios com card compacto
    await p.evaluate(() => [...document.querySelectorAll('#cats-home .cat')].find(b => b.textContent.trim() === 'UFOP').click());
    await espera(800);
    await p.evaluate(() => abrirUFOPSubcat('laboratorios', 'Laboratórios'));
    await p.waitForFunction(() => document.querySelectorAll('#lista-lojas .lugar-card').length > 5, { timeout: 30000 });
    await espera(500);
    const cards = await p.evaluate(() => {
      const c = [...document.querySelectorAll('#lista-lojas .lugar-card')];
      const comp = c.filter(x => x.classList.contains('lugar-card-compacto'));
      return { total: c.length, compactos: comp.length, alturaMedia: Math.round(comp.slice(0, 10).reduce((s, x) => s + x.getBoundingClientRect().height, 0) / Math.max(1, Math.min(10, comp.length))), meta: comp[0] ? comp[0].innerText.replace(/\s+/g, ' ').slice(0, 90) : '' };
    });
    ok('Cards da UFOP sem foto ficam compactos', cards.compactos > 0 && cards.alturaMedia < 110, JSON.stringify(cards));
    await p.evaluate(() => { const t = document.getElementById('tela-home'); t.scrollTop = document.getElementById('lista-lojas').offsetTop - 60; });
    await espera(400);
    await p.screenshot({ path: `${PASTA}/ufop_compacto.png` });
    // abre um card compacto pelo teclado
    await p.evaluate(() => document.querySelector('#lista-lojas .lugar-card-compacto').focus());
    await p.keyboard.press('Enter');
    await espera(600);
    ok('Card compacto abre pelo teclado', (await p.evaluate(() => telaAtual)) === 'tela-lugar');
    ok('Nenhuma caixa nativa do navegador', dialogoNativo === 0, String(dialogoNativo));
  } catch (e) {
    ok('Execução sem falhas', false, String(e.stack || e).slice(0, 300));
  } finally {
    ok('Sem erros de JavaScript', erros.length === 0, erros.join(' | '));
    await browser.close();
    resultados.forEach(r => console.log(`${r.ok ? 'OK  ' : 'FALHA'} ${r.nome}${r.info ? '  — ' + r.info : ''}`));
    console.log(`\n${resultados.filter(r => r.ok).length}/${resultados.length} verificações passaram`);
  }
})();

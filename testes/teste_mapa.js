// Confere a posição de cada lugar no mapa: todo lugar do guia precisa ter pino, no ponto da coordenada
// gravada no banco ou do Plus Code do endereço. Sem gravar nada no banco.
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8000/';
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const resultados = [];
const ok = (nome, cond, info = '') => resultados.push({ nome, ok: !!cond, info });
const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', ...(PROXY ? ['--proxy-server=' + PROXY] : [])] });
  try {
    const p = await browser.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    await p.setRequestInterception(true);
    // Sem a busca no OpenStreetMap: o pino tem de vir do banco ou do Plus Code, e não do acaso de uma busca
    p.on('request', r => (r.url().includes('nominatim.openstreetmap.org') || (r.url().includes('supabase.co') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method()))) ? r.abort() : r.continue());
    await p.evaluateOnNewDocument(() => { localStorage.setItem('dica_visitou', '1'); localStorage.removeItem('dica_geo_v1'); });
    await p.goto(BASE + '#/mapa', { waitUntil: 'networkidle2', timeout: 90000 });
    await p.waitForFunction(() => typeof _marcadores !== 'undefined' && _marcadores.length > 30, { timeout: 60000 });
    await espera(3000);
    const r = await p.evaluate(async () => {
      const h = { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } };
      const pinos = {};
      _marcadores.forEach(({ marcador }) => { const it = marcador.itemData; pinos[it.tabela + ':' + it.id] = marcador.getLatLng(); });
      const faltam = [], longe = [];
      let total = 0;
      for (const t of ['museus', 'igrejas', 'minas', 'parques_cachoeiras']) {
        const lista = await (await fetch(`${SUPA_URL}/rest/v1/${t}?select=id,nome,endereco,lat,lng`, h)).json();
        for (const l of lista) {
          total++;
          const esperado = (l.lat && l.lng) ? [Number(l.lat), Number(l.lng)] : coordDePlusCode(l.endereco);
          const pino = pinos[t + ':' + l.id];
          if (!esperado || !pino) { faltam.push(l.nome); continue; }
          const m = L.latLng(esperado).distanceTo(pino);
          if (m > 1) longe.push(`${l.nome} (${Math.round(m)} m)`);
        }
      }
      return { total, faltam, longe };
    });
    ok(`Todos os ${r.total} lugares do guia têm pino sem depender da busca no OpenStreetMap`, r.faltam.length === 0, r.faltam.length + ' sem pino: ' + r.faltam.join('; '));
    ok('Cada pino fica na coordenada do banco ou do Plus Code', r.longe.length === 0, r.longe.join('; '));
  } catch (err) {
    ok('Execução sem falhas', false, String(err.stack || err).slice(0, 400));
  } finally {
    await browser.close();
    resultados.forEach(x => console.log(`${x.ok ? 'OK  ' : 'FALHA'} ${x.nome}${x.info ? '  — ' + x.info : ''}`));
    console.log(`\n${resultados.filter(x => x.ok).length}/${resultados.length} verificações passaram`);
  }
})();

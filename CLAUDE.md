# Dica de Ouro — contexto do projeto

Guia de Ouro Preto (MG) para turistas e moradores: lojas e serviços, agenda de eventos, mapa, repúblicas e conteúdos da UFOP. Publicado em https://guiadicadeouro.com.br pelo GitHub Pages (o arquivo `CNAME` aponta o domínio).

## Como o projeto é

- Tudo fica em um único `index.html`: o CSS no `<style>` do `<head>`, cada tela é um `<div class="tela" id="tela-...">` e o JavaScript fica no `<script>` no fim do `<body>`.
- A navegação usa `irPara(id)`, `voltarPara(id)` e `irTab(tela, tab)`; telas escondidas levam a classe `oculta` (e ficam `inert`). Abas: Início, Agenda, Explorar e Salvos.
- Cada tela tem endereço próprio (`#/lugar/…`, `#/evento/…`, `#/loja/…`, `#/agenda/…`, `#/mapa/…`, `#/salvos`). As rotas ficam no último `<script>` da página e envolvem as funções de navegação; o voltar do celular usa o histórico do navegador.
- Backend: Supabase, chamado com `fetch` direto (REST em `/rest/v1`, Auth em `/auth/v1`, Storage em `/storage/v1`), sem SDK.
- Tabelas: `lojas` (colunas em maiúsculas, algumas com acento: `NOME`, `CATEGORIA`, `ENDEREÇO`, `DESCRIÇÃO`, `TELEFONE`, `SITE`, `FOTO`, `ATUALIZADO_EM`, `ACESSOS`, além de `lojista_id`, `lat`, `lng`), `republicas`, `ufop_conteudo`, `eventos`, `avaliacoes`, `acessos`, `igrejas`, `museus`, `minas`, `parques_cachoeiras`. Função `rpc/incrementar_acessos`. Bucket de fotos `fotos-lojas`.
- Mapa com Leaflet 1.9.4 (unpkg), baixado só ao abrir o Explorar (`carregarLeaflet()`). Fontes do Google Fonts. Imagens próprias em `img/` (gravuras da home por horário, ilustrações das categorias, prévia de link).
- Salvos ficam no `localStorage` (`dica_favoritos`), com `tipo` (`loja`, `lugar`, `evento`, `ufop`, `republica`). Ações vão para a tabela `acessos` com `visitante` e `origem` (`?origem=` no link).
- A sessão do anunciante fica no `localStorage` (`dica_token`, `dica_uid`, `dica_email`).

## Regras

- A interface é em português do Brasil.
- Sem framework, bundler ou dependências novas: o site continua estático.
- `SUPA_KEY` é a chave publicável do Supabase e pode ficar no código. Gravações do anunciante usam o token dele, nunca a chave pública. Quem protege os dados são as regras (RLS) no banco.
- Nunca rode SQL nem grave dados no Supabase de produção. Mudanças de banco vão em arquivos `.sql` para o dono rodar no SQL Editor.
- Preserve os `id`, as classes usadas pelo JavaScript e as funções chamadas em `onclick`. Antes de renomear qualquer coisa, procure todos os usos.
- Todo texto vindo do banco que entra em `innerHTML` passa por `esc()`.
- A pasta `_plano/` não é versionada (fica no `.gitignore`), porque o repositório é público.
- Para testar, sirva com `python3 -m http.server 8000` e confira em 390×844 e numa tela larga.

## Testes

- Os testes ficam em `testes/` e rodam no Chrome sem janela. Na primeira vez: `cd testes && npm install`.
- Com o site servido em `python3 -m http.server 8000`, rode cada um: `node testes/teste_fase1.js http://localhost:8000/` (e `teste_rotas.js`, `teste_2c.js`, `teste_lote3.js`). Também rodam contra https://guiadicadeouro.com.br/.
- Eles nunca gravam no Supabase: a página responde às gravações localmente e a rede bloqueia qualquer escrita. Usam o Chrome de `CHROME_PATH` (padrão `/usr/bin/google-chrome`).
- Antes de publicar, todos precisam passar. Ao mudar uma tela, ajuste ou acrescente as verificações dela.

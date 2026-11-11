# Dica de Ouro — contexto do projeto

Guia de Ouro Preto (MG) para turistas e moradores: lojas e serviços, agenda de eventos, mapa, repúblicas e conteúdos da UFOP. Publicado em https://guiadicadeouro.com.br pelo GitHub Pages (o arquivo `CNAME` aponta o domínio).

## Como o projeto é

- Tudo fica em um único `index.html`: o CSS no `<style>` do `<head>`, cada tela é um `<div class="tela" id="tela-...">` e o JavaScript fica no `<script>` no fim do `<body>`.
- A navegação usa `irPara(id)`, `voltarPara(id)` e `irTab(tela, tab)`; telas escondidas levam a classe `oculta`.
- Backend: Supabase, chamado com `fetch` direto (REST em `/rest/v1`, Auth em `/auth/v1`, Storage em `/storage/v1`), sem SDK.
- Tabelas: `lojas` (colunas em maiúsculas, algumas com acento: `NOME`, `CATEGORIA`, `ENDEREÇO`, `DESCRIÇÃO`, `TELEFONE`, `SITE`, `FOTO`, `ATUALIZADO_EM`, `ACESSOS`, além de `lojista_id`, `lat`, `lng`), `republicas`, `ufop_conteudo`, `eventos`, `avaliacoes`, `acessos`, `igrejas`, `museus`, `minas`, `parques_cachoeiras`. Função `rpc/incrementar_acessos`. Bucket de fotos `fotos-lojas`.
- Mapa com Leaflet 1.9.4 (unpkg). Fontes do Google Fonts.
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

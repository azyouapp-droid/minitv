# Mini TV — nova interface

Abra **ABRIR MINI TV.cmd** com dois cliques. O aplicativo abre em http://localhost:8790. Mantenha a janela do servidor aberta enquanto assiste. Requer Node.js, já instalado neste computador, e internet para as transmissões e a biblioteca do player.

Esta é uma cópia local do projeto de https://mini-tv-pedro.insplay8.chatgpt.site. O projeto original e o site publicado não foram alterados.

## O que funciona

- Catálogo existente com 147 canais, organizados por categoria.
- Busca pelo botão de lupa no centro da barra inferior.
- Favoritos salvos no navegador.
- Reprodução mantida ao pesquisar, navegar e favoritar. O canal só muda no botão Assistir.
- Player fixo durante a navegação e interface adaptada para celular e computador.
- Opções de reprodução e atualização do catálogo do projeto original.

As transmissões e sua disponibilidade dependem dos provedores existentes. As letras nos cartões identificam os canais; não foram inventados horários nem títulos de programas.

## Desenvolvimento

`npm start` inicia o servidor local. `npm run build` atualiza dist a partir de worker/index.js. `npm run check` verifica a sintaxe do servidor. A página utilizada pelo aplicativo está incorporada em worker/index.js; index.html é sua cópia legível. Para alterações futuras, mantenha as duas versões sincronizadas.

Verificado no navegador: carregamento do catálogo, busca por Discovery e ESPN, favoritos, reprodução do Discovery Channel e continuidade do vídeo durante a pesquisa de outro canal.

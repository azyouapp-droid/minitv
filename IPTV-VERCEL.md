# IPTV privado na Vercel

A versão local lê .iptv-local.json e .iptv-cache.m3u; esses arquivos não devem ser enviados ao GitHub nem à hospedagem.

Na Vercel configure, apenas no servidor:
- IPTV_PLAYLIST_URL: URL HLS do acesso do provedor.
- IPTV_SIGNING_SECRET: segredo aleatório com pelo menos 32 caracteres.
- IPTV_TEST_PASSWORD: senha exclusiva para abrir o catálogo do teste privado.

Depois de alterar variáveis, publique novamente. Ao abrir o site, informe a senha do teste. O cookie de acesso dura 24 horas. As credenciais do provedor não são incluídas no catálogo nem nas URLs do navegador. As URLs dos trechos usam assinatura verificável entre instâncias; o servidor resolve os tokens atuais do provedor.

O adaptador usa a API Xtream get_live_streams e playlists de mídia HLS. Ele preserva o limite do plano; não agrega conexões nem oferece acesso ilimitado. Testes em navegadores distintos podem disputar a única conexão. A Vercel transporta os vídeos pelo servidor: acompanhe uso de banda e funções. A reprodução precisa ser validada na rede móvel e depende do provedor aceitar os servidores da hospedagem.

Validação: node --test --test-isolation=none scripts/iptv-cloud.test.mjs

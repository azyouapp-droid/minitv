# IPTV na Vercel

Configure IPTV_PLAYLIST_URL e IPTV_SIGNING_SECRET como segredos de produção. Não publique .iptv-local.json nem .iptv-cache.m3u.

Por solicitação confirmada do proprietário, não há senha de entrada. Qualquer visitante consegue usar o catálogo e a transmissão pelo acesso configurado. As credenciais do provedor continuam no servidor, e os links de mídia usam assinatura contra alteração do destino.

O plano mantém seu limite de conexões. Teste com node --test --test-isolation=none scripts/iptv-cloud.test.mjs.

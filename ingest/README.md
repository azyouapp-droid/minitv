# Mini TV continuous channel receiver

This service keeps an upstream HLS connection running for each **currently watched** channel. The first playlist request starts FFmpeg; the player's repeated playlist requests keep it alive. After `idleSeconds` without a viewer request, it stops. It restarts a stalled or exited FFmpeg process while viewers remain.

It must run on a machine or service that stays on continuously. The Sites Worker cannot keep a video ingest process running after a request ends. This service does not transcode; the upstream codecs must already be playable in the target browsers. Use a CDN or reverse proxy in front of it for multiple viewers and HTTPS. Do not expose the upstream URL or credentials to browser code.

## Configuration

Copy `config.example.json` to `config.json` and replace the sample URL with an authorized HLS source. Keep `config.json` private. Set `FFMPEG_BIN` if FFmpeg is not on `PATH`. Optional environment variables are `INGEST_CONFIG`, `INGEST_DATA`, `INGEST_HOST` (default `127.0.0.1`) and `INGEST_PORT` (default `8788`).

Run `npm start`. A channel's playlist is at `/channel/<id>/index.m3u8`. `/health` reports which receivers are active. The first request may take up to `startupSeconds` while FFmpeg produces segments; after that the same receiver serves all viewers of that channel. Set `maxActiveChannels` to cap upstream connections. Configure a CDN to cache immutable `.ts` segments while keeping `index.m3u8` fresh.

No source is activated until it is added to the private configuration. The deployed Mini TV still uses its current playback path until a continuously running receiver and public HTTPS delivery address are configured.

To connect a channel, add its public **receiver or CDN** playlist address as `ingestUrl` in the Site catalog entry, for example `https://video.example/channel/canal-exemplo/index.m3u8`. The site player will use that address when present and retain the existing route for other channels. The URL must not contain the upstream supplier's credentials. The receiver sends CORS headers for browser playback; put HTTPS and viewer access controls at the public edge.

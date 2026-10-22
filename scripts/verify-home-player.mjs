import { spawn } from 'node:child_process';
import http from 'node:http';

async function run() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9333;
  
  const edge = spawn(edgePath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ]);

  try {
    // Wait for CDP to be ready
    let targets = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 250));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        targets = await res.json();
        if (targets && targets.length > 0) break;
      } catch {}
    }

    if (!targets || !targets.length) {
      throw new Error('CDP targets not available');
    }

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const wsUrl = pageTarget.webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);

    let msgId = 1;
    const pending = new Map();

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        pending.get(data.id)(data);
        pending.delete(data.id);
      }
    };

    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Navigating to http://localhost:8790...');
    const loadPromise = new Promise((resolve) => {
      const origHandler = ws.onmessage;
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.method === 'Page.loadEventFired') {
          resolve();
        }
        if (data.id && pending.has(data.id)) {
          pending.get(data.id)(data);
          pending.delete(data.id);
        }
      };
    });

    await send('Page.navigate', { url: 'http://localhost:8790' });
    await Promise.race([loadPromise, new Promise(r => setTimeout(r, 4000))]);
    await new Promise(r => setTimeout(r, 1500));

    async function evalCode(expression) {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      console.log('EVAL RESPONSE:', JSON.stringify(res?.result?.result));
      return res.result?.result?.value !== undefined ? res.result.result.value : res.result?.value;
    }

    const pageUrl = await evalCode('window.location.href');
    const pageTitle = await evalCode('document.title');
    console.log('Current page:', pageUrl, pageTitle);
    const initialHome = await evalCode(`(() => {
      const emptyHero = document.getElementById('home-empty-hero');
      const playerWrapper = document.getElementById('player-wrapper');
      const homeSlot = document.getElementById('home-hero-slot');
      const watchSlot = document.getElementById('watch-player-slot');
      return {
        mode: document.getElementById('app').dataset.mode,
        emptyHeroVisible: emptyHero ? window.getComputedStyle(emptyHero).display !== 'none' : false,
        playerParent: playerWrapper?.parentElement?.id,
        emptyHeroText: emptyHero?.querySelector('h2')?.textContent
      };
    })()`);

    console.log('Step 1 - Initial Home state:', initialHome);

    // Step 2: Click "Escolher um canal"
    await evalCode(`document.getElementById('hero-explore-btn').click()`);
    await new Promise(r => setTimeout(r, 600));

    const channelsState = await evalCode(`(() => {
      return {
        mode: document.getElementById('app').dataset.mode,
        browseVisible: window.getComputedStyle(document.getElementById('browse')).display !== 'none',
        firstChannelName: document.querySelector('.channel-card h3')?.textContent
      };
    })()`);

    console.log('Step 2 - After clicking Escolher um canal:', channelsState);

    // Step 3: Click first channel "Assistir" button
    console.log('Step 3 - Clicking first channel...');
    await evalCode(`document.querySelector('.channel-card .watch-btn').click()`);
    await new Promise(r => setTimeout(r, 2000));

    const playingState = await evalCode(`(() => {
      const video = document.getElementById('video');
      return {
        mode: document.getElementById('app').dataset.mode,
        selectedName: document.getElementById('title')?.textContent,
        videoSrc: video?.src || '',
        videoPaused: video?.paused
      };
    })()`);

    console.log('Step 3 - Channel watching state:', playingState);

    // Step 4: Click "Home" bottom-nav button
    console.log('Step 4 - Navigating to Home while channel is playing...');
    await evalCode(`document.querySelector('.bottom-nav [data-view="home"]').click()`);
    await new Promise(r => setTimeout(r, 1000));

    const homeWithPlayer = await evalCode(`(() => {
      const emptyHero = document.getElementById('home-empty-hero');
      const playerWrapper = document.getElementById('player-wrapper');
      const homeSlot = document.getElementById('home-hero-slot');
      const stopBtn = document.getElementById('stop-channel');
      const tag = document.getElementById('player-top-channel-tag');
      const video = document.getElementById('video');
      return {
        mode: document.getElementById('app').dataset.mode,
        playerInHomeSlot: playerWrapper?.parentElement === homeSlot,
        emptyHeroDisplay: window.getComputedStyle(emptyHero).display,
        stopBtnVisible: stopBtn ? window.getComputedStyle(stopBtn).display : 'none',
        channelTag: tag?.textContent,
        videoPlaying: video ? !video.paused : false
      };
    })()`);

    console.log('Step 4 - Home with active player:', homeWithPlayer);

    // Step 5: Click "Parar" button
    console.log('Step 5 - Clicking Parar button...');
    await evalCode(`document.getElementById('stop-channel').click()`);
    await new Promise(r => setTimeout(r, 800));

    const afterStop = await evalCode(`(() => {
      const emptyHero = document.getElementById('home-empty-hero');
      const playerWrapper = document.getElementById('player-wrapper');
      const watchSlot = document.getElementById('watch-player-slot');
      const video = document.getElementById('video');
      return {
        mode: document.getElementById('app').dataset.mode,
        playerBackInWatchSlot: playerWrapper?.parentElement === watchSlot,
        emptyHeroDisplay: window.getComputedStyle(emptyHero).display,
        videoPaused: video ? video.paused : true,
        videoHasSrc: !!video?.getAttribute('src')
      };
    })()`);

    console.log('Step 5 - After clicking Parar:', afterStop);

    // Step 6: Test shortcut button on empty hero (e.g. Esportes)
    console.log('Step 6 - Clicking shortcut tag [Esportes]...');
    await evalCode(`document.querySelector('.empty-tag[data-cat="Esportes"]').click()`);
    await new Promise(r => setTimeout(r, 600));

    const shortcutState = await evalCode(`(() => {
      return {
        mode: document.getElementById('app').dataset.mode,
        browseVisible: window.getComputedStyle(document.getElementById('browse')).display !== 'none',
        selectedCategory: document.getElementById('category')?.value,
        browseTitle: document.getElementById('browse-title')?.textContent
      };
    })()`);

    console.log('Step 6 - After clicking shortcut:', shortcutState);

    ws.close();
    edge.kill();

    const passed =
      initialHome.emptyHeroVisible &&
      initialHome.playerParent === 'watch-player-slot' &&
      channelsState.browseVisible &&
      homeWithPlayer.playerInHomeSlot &&
      homeWithPlayer.emptyHeroDisplay === 'none' &&
      homeWithPlayer.stopBtnVisible !== 'none' &&
      afterStop.playerBackInWatchSlot &&
      afterStop.emptyHeroDisplay !== 'none' &&
      shortcutState.selectedCategory === 'Esportes';

    if (passed) {
      console.log('\n>>> ALL 6 HOME PLAYER INTEGRATION CHECKS PASSED SUCCESSFULLY! <<<');
      process.exit(0);
    } else {
      console.error('\n>>> SOME CHECKS FAILED! <<<');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error during test:', err);
    edge.kill();
    process.exit(1);
  }
}

run();

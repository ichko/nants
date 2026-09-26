// A small static player for the deck in project/: one slide on screen at a
// time, scaled to the window, click or arrow keys to advance. Elements marked
// data-build-in="kind N" appear on the Nth click; an <x-embed> becomes a
// sandboxed iframe made the moment it is revealed, so its first paint is the click.
(async function () {
  const stage = document.getElementById('stage'), pos = document.getElementById('pos');
  const deck = await (await fetch('project/deck.json')).json();
  for (const f of Object.values(deck.faces || {})) if (f.href) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = f.href; document.head.appendChild(l);
  }
  const order = deck.order;
  const html = {};
  await Promise.all(order.map(async id => { html[id] = await (await fetch('project/slides/' + id + '.html')).text(); }));

  let at = 0, step = 0, section = null, steps = 0;
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'scale(' + s + ')';
    stage.style.left = Math.round((innerWidth - 1920 * s) / 2) + 'px';
    stage.style.top = Math.round((innerHeight - 1080 * s) / 2) + 'px';
  }
  function buildOf(el) { const m = /(\d+)/.exec(el.getAttribute('data-build-in') || ''); return m ? +m[1] : 0; }
  function embed(x) {
    const f = document.createElement('iframe');
    f.setAttribute('style', x.getAttribute('style') || '');
    f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + x.innerHTML + '</body></html>';
    x.replaceWith(f); return f;
  }
  function show(i, s) {
    at = Math.max(0, Math.min(order.length - 1, i));
    const t = document.createElement('template'); t.innerHTML = html[order[at]].trim();
    section = t.content.firstElementChild;
    stage.replaceChildren(section);
    steps = 0; section.querySelectorAll('[data-build-in]').forEach(e => { steps = Math.max(steps, buildOf(e)); });
    step = Math.max(0, Math.min(steps, s || 0));
    // embeds with no build come alive at once; built ones wait for their click
    section.querySelectorAll('x-embed').forEach(x => { if (!x.hasAttribute('data-build-in')) embed(x); });
    reveal();
    section.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; a.addEventListener('click', e => e.stopPropagation()); });
    location.replace('#' + (at + 1) + (step ? '.' + step : ''));
    pos.textContent = (at + 1) + ' / ' + order.length;
  }
  function reveal() {
    section.querySelectorAll('[data-build-in]').forEach(e => {
      if (buildOf(e) <= step && !e.classList.contains('on')) {
        e.classList.add('on');
        if (e.tagName === 'X-EMBED') {
          // a trigger embed only posts a stage number to its sibling embeds: deliver it directly
          const t = /postMessage\(\{(nants[A-Za-z]+):(\d+)\}/.exec(e.innerHTML);
          if (t) { const msg = {}; msg[t[1]] = +t[2]; e.remove(); stage.querySelectorAll('iframe').forEach(f => f.contentWindow && f.contentWindow.postMessage(msg, '*')); }
          else { const f = embed(e); f.classList.add('on'); f.setAttribute('data-build-in', ''); }
        }
      }
    });
  }
  function next() { if (step < steps) { step++; reveal(); location.replace('#' + (at + 1) + '.' + step); } else if (at < order.length - 1) show(at + 1, 0); }
  function prev() { if (at > 0) show(at - 1, 0); }
  addEventListener('resize', fit); fit();
  addEventListener('keydown', e => {
    if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === 'Home') show(0, 0); else if (e.key === 'End') show(order.length - 1, 0);
    else if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  });
  stage.addEventListener('click', e => { if (e.clientX < innerWidth * 0.15) prev(); else next(); });
  function fromHash() { const m = /#(\d+)(?:\.(\d+))?/.exec(location.hash); return m ? [+m[1] - 1, +(m[2] || 0)] : [0, 0]; }
  addEventListener('hashchange', () => { const [i, s] = fromHash(); if (i !== at || s !== step) show(i, s); });
  const [i0, s0] = fromHash(); show(i0, s0);
})();

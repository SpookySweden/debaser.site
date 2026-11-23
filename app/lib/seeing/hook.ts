/**
 * Our script in the frame (SPEC-seeing-machine.md, "Scripts on"): the first thing that runs there, before anything the page brought. It
 * hands pressed links to the site, gives the page in-memory storage in place of the storage it may not have, and passes what its scripts
 * ask for to the site, which asks for it under the same checks as everything else.
 *
 * The guards are the sandbox, the policy and the server, with one exception: what no policy in Chrome stops. WebRTC, and the hints a `<link>`
 * gives (preconnect, dns-prefetch), reach another host straight from the reader's browser. The hook takes WebRTC away and lets no frame be
 * made, since a frame is a fresh window with it back, and no link element at all: none can be created, and no markup holding one written
 * (Trusted Types, which the browser itself enforces). That part runs in the page's own window and is written to lean on nothing in it.
 *
 * Plain browser script as text, put into the frame's document. No backticks in it, and no `</`.
 */
export const HOOK = String.raw`(function (config) {
  'use strict';
  var site = window.parent.parent, to = config.site, page = config.page;
  var sheet = document.createElement('style'), dressed = false, restricted = 0, told = 0, waiting = {}, number = 0;
  function say(message) { site.postMessage(message, to); }
  function show() { if (!dressed) { dressed = true; document.documentElement.removeAttribute('data-see-waiting'); } }
  function restrict() { restricted += 1; if (!told) { told = 1; setTimeout(function () { told = 0; say({ see: 'restricted', count: restricted }); }, 500); } }
  function ask(message) {
    return new Promise(function (done) { var id = ++number; waiting[id] = done; message.id = id; say(message); });
  }
  document.head.appendChild(sheet);
  sheet.setAttribute('data-see-sheet', '');

  window.addEventListener('message', function (event) {
    if (event.source !== site || !event.data || typeof event.data !== 'object') return;
    var data = event.data;
    if (data.see === 'dress' && typeof data.css === 'string') { sheet.textContent = data.css; (document.head || document.documentElement).appendChild(sheet); use(data.tools); show(); event.stopImmediatePropagation(); }
    else if (data.see === 'answer' && waiting[data.id]) { var done = waiting[data.id]; delete waiting[data.id]; event.stopImmediatePropagation(); done(data); }
    else if (data.see === 'scrollTo' && typeof data.y === 'number') { scrollTo_(data); event.stopImmediatePropagation(); }
    else if (data.see === 'art' && Array.isArray(data.pieces)) { hang(data.pieces); event.stopImmediatePropagation(); }
  }, true);

  /* --- lens tools ---------------------------------------------------------------------------------------------------
     What a lens needs done to the page itself, as the site asks with each dressing. Each can be undone. */
  var tools = {}, seenBody = false;
  function hexOf(text) { var n = parseInt(text.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function rgbOf(text) { var n = String(text).match(/[\d.]+/g); return n && /^rgb/.test(text) ? { rgb: [Number(n[0]), Number(n[1]), Number(n[2])], alpha: n.length > 3 ? Number(n[3]) : 1 } : null; }
  function light(c) { var v = [c[0], c[1], c[2]].map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
  function contrast(a, b) { var x = light(a), y = light(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // Near in colour, and nearer still in how light it is, so what was dark on light stays so.
  function far(a, b) { var l = (0.3 * (a[0] - b[0]) + 0.59 * (a[1] - b[1]) + 0.11 * (a[2] - b[2])); return 4 * l * l + (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]); }
  function nearest(c, dyes) { var best = dyes[0], least = Infinity; for (var i = 0; i < dyes.length; i += 1) { var d = far(c, dyes[i]); if (d < least) { least = d; best = dyes[i]; } } return best; }
  function reads(c, ground, dyes) {
    var pick = nearest(c, dyes);
    if (contrast(pick, ground) >= 4.5) return pick;
    var best = pick, most = 0, least = Infinity;
    dyes.forEach(function (dye) { var ratio = contrast(dye, ground), d = far(c, dye); if (ratio >= 4.5 && d < least) { least = d; best = dye; most = 99; } else if (most < 99 && ratio > most) { most = ratio; best = dye; } });
    return best;
  }
  function css(c) { return 'rgb' + '(' + c[0] + ', ' + c[1] + ', ' + c[2] + ')'; }

  /* THEME DYE: every colour moved to the nearest of the theme's dyes. */
  var dyed = new Map(), bare = new Set(), dyedPictures = new Map(), dyeTimer = 0;
  function put_(element, name, value) {
    var was = dyed.get(element);
    if (!was) { was = {}; dyed.set(element, was); if (!element.hasAttribute('style')) bare.add(element); }
    if (!(name in was)) was[name] = [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)];
    element.style.setProperty(name, value, 'important');
  }
  function undye() {
    dyed.forEach(function (was, element) { Object.keys(was).forEach(function (name) { if (was[name][0]) element.style.setProperty(name, was[name][0], was[name][1]); else element.style.removeProperty(name); }); if (bare.has(element) && element.getAttribute('style') === '') element.removeAttribute('style'); });
    dyed.clear(); bare.clear();
  }
  function dyeAll(dyes, paper) {
    var grounds = new Map(), list = document.body ? [document.documentElement, document.body].concat(Array.prototype.slice.call(document.body.querySelectorAll('*'), 0, 12000)) : [];
    var plan = list.map(function (element) { var look = getComputedStyle(element); return { element: element, ground: rgbOf(look.backgroundColor), image: look.backgroundImage, ink: rgbOf(look.color), border: rgbOf(look.borderTopColor), bordered: parseFloat(look.borderTopWidth) > 0 || parseFloat(look.borderBottomWidth) > 0, fill: element instanceof SVGElement ? rgbOf(look.fill) : null, stroke: element instanceof SVGElement ? rgbOf(look.stroke) : null }; });
    plan.forEach(function (one) {
      var above = one.element.parentElement ? grounds.get(one.element.parentElement) : null, ground = above || paper;
      if (one.ground && one.ground.alpha > 0.4) { ground = nearest(one.ground.rgb, dyes); put_(one.element, 'background-color', css(ground)); }
      else if (one.ground && one.ground.alpha > 0) put_(one.element, 'background-color', 'transparent');
      else if (one.element === document.documentElement) put_(one.element, 'background-color', css(paper));
      if (/gradient/.test(one.image)) put_(one.element, 'background-image', 'none');
      grounds.set(one.element, ground);
      if (one.ink) put_(one.element, 'color', css(reads(one.ink.rgb, ground, dyes)));
      if (one.border && one.bordered) put_(one.element, 'border-color', css(nearest(one.border.rgb, dyes)));
      if (one.fill && one.fill.alpha > 0) put_(one.element, 'fill', css(nearest(one.fill.rgb, dyes)));
      if (one.stroke && one.stroke.alpha > 0) put_(one.element, 'stroke', css(nearest(one.stroke.rgb, dyes)));
    });
  }

  /* Pictures dithered to a few colours, in steps a page in front of you can spare. Signed files answer anybody, so a canvas may read them. */
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function ditherPicture(picture, dyes, most) {
    return new Promise(function (done) {
      var copy = new Image();
      setCross(copy, 'anonymous');
      copy.onload = function () {
        try {
          var scale = Math.min(1, most / Math.max(copy.naturalWidth, copy.naturalHeight, 1)), w = Math.max(1, Math.round(copy.naturalWidth * scale)), h = Math.max(1, Math.round(copy.naturalHeight * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var pen = canvas.getContext('2d');
          pen.drawImage(copy, 0, 0, w, h);
          var data = pen.getImageData(0, 0, w, h), p = data.data;
          for (var y = 0; y < h; y += 1) for (var x = 0; x < w; x += 1) {
            var at = (y * w + x) * 4, nudge = (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * 72;
            var to = nearest([p[at] + nudge, p[at + 1] + nudge, p[at + 2] + nudge], dyes);
            p[at] = to[0]; p[at + 1] = to[1]; p[at + 2] = to[2];
          }
          pen.putImageData(data, 0, 0);
          done(canvas.toDataURL('image/png'));
        } catch (error) { done(null); }
      };
      copy.onerror = function () { done(null); };
      // What is drawn, which is not always what it says: a set of sizes wins over it.
      setSrc(copy, picture.currentSrc || getSrc(picture));
    });
  }
  // Taken before the page has run, and called without asking anything the page could put in their place (see the guard, below).
  var uncurry = Function.prototype.bind.bind(Function.prototype.call), plainSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src'), setSrc = uncurry(plainSrc.set), getSrc = uncurry(plainSrc.get), setCross = uncurry(Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'crossOrigin').set), ditherRun = 0;
  function undither() { ditherRun += 1; dyedPictures.forEach(function (was, picture) { setSrc(picture, was.src); if (was.srcset) picture.setAttribute('srcset', was.srcset); picture.style.removeProperty('image-rendering'); if (picture.getAttribute('style') === '') picture.removeAttribute('style'); });
    document.querySelectorAll('source[data-see-media-was]').forEach(function (source) { var was = source.getAttribute('data-see-media-was'); if (was) source.setAttribute('media', was); else source.removeAttribute('media'); source.removeAttribute('data-see-media-was'); }); dyedPictures.clear(); }
  function ditherAll(dyes, most) {
    var run = (ditherRun += 1);
    var pictures = Array.prototype.slice.call(document.images).filter(function (picture) { return picture.complete && picture.naturalWidth > 8 && !dyedPictures.has(picture) && picture.getBoundingClientRect().width > 8; }).slice(0, 60);
    (function next() {
      var picture = pictures.shift();
      if (!picture || run !== ditherRun) return;
      ditherPicture(picture, dyes, most).then(function (made) {
        if (made && run === ditherRun && picture.isConnected) {
          dyedPictures.set(picture, { src: getSrc(picture), srcset: picture.getAttribute('srcset') });
          picture.removeAttribute('srcset');
          if (picture.parentElement && picture.parentElement.localName === 'picture') picture.parentElement.querySelectorAll('source').forEach(function (source) { if (!source.hasAttribute('data-see-media-was')) { source.setAttribute('data-see-media-was', source.getAttribute('media') || ''); source.setAttribute('media', 'not all'); } });
          picture.style.setProperty('image-rendering', 'pixelated');
          setSrc(picture, made);
        }
        setTimeout(next, 15);
      });
    })();
  }

  /* GLASS: each run of words on a strip of its own. */
  var strips = [];
  function strip() {
    if (!document.body) return;
    var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), found = [], node;
    while ((node = walk.nextNode()) && found.length < 6000) if (node.nodeValue.trim() && node.parentElement && !/^(?:script|style|textarea|option|select|title|see-strip|noscript)$/.test(node.parentElement.localName)) found.push(node);
    found.forEach(function (text) { var wrap = document.createElement('see-strip'); text.parentNode.insertBefore(wrap, text); wrap.appendChild(text); strips.push(wrap); });
  }
  function unstrip() { strips.forEach(function (wrap) { while (wrap.firstChild) wrap.parentNode && wrap.parentNode.insertBefore(wrap.firstChild, wrap); wrap.remove(); }); strips = []; }

  /* X-RAY: what is pointed at, and what the page is made of. */
  var pointed = null, pointing = 0;
  function nameOf(element) { return element.localName + (element.id ? '#' + element.id : '') + (typeof element.className === 'string' && element.className.trim() ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.') : ''); }
  function kindNamed(element) { return element.localName === 'a' ? 'LINK' : /^(?:img|picture|svg|video|canvas)$/.test(element.localName) ? 'PICTURE' : element.hasAttribute('data-see-frame') ? 'FRAME' : /^(?:script|see-link|style)$/.test(element.localName) ? 'SCRIPT' : /^(?:input|button|select|textarea|form|label)$/.test(element.localName) ? 'FORM' : 'WORDS'; }
  function point(element) {
    if (pointed) pointed.removeAttribute('data-see-pointed');
    pointed = element;
    element.setAttribute('data-see-pointed', '');
    var box = element.getBoundingClientRect(), look = getComputedStyle(element), path = [];
    for (var at = element; at && path.length < 12; at = at.parentElement) path.unshift(nameOf(at).slice(0, 60));
    say({ see: 'point', path: path, kind: kindNamed(element), size: Math.round(box.width) + ' x ' + Math.round(box.height), ink: look.color, ground: look.backgroundColor, face: (look.fontSize + ' ' + look.fontFamily).slice(0, 120), words: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160), inside: element.querySelectorAll('*').length });
  }
  function census() {
    var count = function (what) { return document.querySelectorAll(what).length; };
    var rows = [];
    (function walk(element, depth) {
      for (var i = 0; i < element.children.length && rows.length < 160; i += 1) {
        var child = element.children[i];
        if (/^(?:script|style|template|see-link)$/.test(child.localName)) continue;
        rows.push({ depth: depth, name: nameOf(child).slice(0, 60), inside: child.querySelectorAll('*').length });
        if (depth < 5) walk(child, depth + 1);
      }
    })(document.body || document.documentElement, 0);
    say({ see: 'census', counts: { words: (document.body ? document.body.innerText.match(/\S+/g) || [] : []).length, pictures: count('img, svg, canvas, video'), links: count('a[href]'), frames: count('[data-see-frame]'), scripts: count('script') - 1, forms: count('form, input, select, textarea, button') }, rows: rows });
  }

  /* ERASE: point, press, gone. The site keeps which, and sends it back as a stylesheet. */
  function selectorOf(element) {
    var parts = [];
    // GLASS's strips are ours and go with it: what is erased is what they stand in.
    while (element && element.localName === 'see-strip') element = element.parentElement;
    for (var at = element; at && at !== document.documentElement && parts.length < 8; at = at.parentElement) {
      if (at.id && /^[A-Za-z][\w-]{0,60}$/.test(at.id)) { parts.unshift('#' + at.id); break; }
      var index = 1, before = at;
      while ((before = before.previousElementSibling)) if (before.localName === at.localName) index += 1;
      if (!/^[a-z][a-z0-9-]{0,40}$/.test(at.localName)) return null;
      parts.unshift(at.localName + ':nth-of-type(' + index + ')');
    }
    return parts.length === 0 || (parts.length === 1 && /^(?:body|html)/.test(parts[0])) ? null : parts.join(' > ');
  }

  document.addEventListener('mousemove', function (event) {
    if (!event.isTrusted || pointing || !(tools.xray || tools.erase || tools.pointer)) return;
    pointing = requestAnimationFrame(function () {
      pointing = 0;
      if (tools.pointer) say({ see: 'pointer', x: Math.round(event.clientX), y: Math.round(event.clientY) });
      var element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      if (tools.xray && element !== pointed) point(element);
      else if (tools.erase && element !== pointed) { if (pointed) pointed.removeAttribute('data-see-pointed'); pointed = element; element.setAttribute('data-see-pointed', ''); }
    });
  }, true);
  document.documentElement.addEventListener('mouseleave', function () { if (tools.pointer) say({ see: 'pointer', x: -9000, y: -9000 }); });
  window.addEventListener('click', function (event) {
    if (!tools.erase || !event.isTrusted || !(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var selector = selectorOf(event.target);
    if (selector) say({ see: 'erase', selector: selector });
  }, true);

  /* What the reader has selected, for a quote, while the site asks. */
  function chosen(event) { if (tools.select && event.isTrusted) setTimeout(function () { var picked = window.getSelection(); say({ see: 'select', text: picked ? String(picked).slice(0, 2000).replace(/\s+/g, ' ').trim().slice(0, 300) : '' }); }, 0); }
  window.addEventListener('mouseup', chosen, true);
  window.addEventListener('keyup', chosen, true);

  /* Two drawings of one page, kept at the same place. */
  var movedAt = 0, scrollTimer = 0;
  window.addEventListener('scroll', function () {
    if (!tools.scroll || scrollTimer || Date.now() - movedAt < 250) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = 0;
      var page = document.scrollingElement || document.documentElement;
      say({ see: 'scroll', x: page.scrollLeft, y: page.scrollTop, whole: Math.max(1, page.scrollHeight - page.clientHeight) });
    }, 30);
  }, { passive: true, capture: true });
  function scrollTo_(data) {
    var page = document.scrollingElement || document.documentElement, whole_ = Math.max(1, page.scrollHeight - page.clientHeight);
    movedAt = Date.now();
    // The same page is put at the same place; another form of it, as far through.
    page.scrollTop = Math.abs(whole_ - data.whole) < 40 ? data.y : (data.y / Math.max(1, data.whole)) * whole_;
    page.scrollLeft = data.x;
  }

  var again = 0;
  function use(next) {
    next = next && typeof next === 'object' ? next : {};
    if (pointed && !next.xray && !next.erase) { pointed.removeAttribute('data-see-pointed'); pointed = null; }
    if (next.xray && !tools.xray) setTimeout(census, 60);
    undye(); undither(); unstrip();
    tools = next;
    clearTimeout(again);
    var run = function () {
      if (tools.dye) dyeAll(tools.dye.dyes.map(hexOf), hexOf(tools.dye.paper));
      if (tools.strips) strip();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
    // Again a little later: pictures just put back, or only now scrolled to, are not drawn yet.
    if (tools.pictures) [120, 1500, 4000].forEach(function (after) { var for_ = tools; setTimeout(function () { if (tools === for_) ditherAll(tools.pictures.dyes.map(hexOf), tools.pictures.most); }, after); });
  }
  // What a page puts in later is dressed too, in a while, not at once.
  new MutationObserver(function (changes) {
    if (!(tools.dye || tools.strips || tools.pictures) || !changes.some(function (change) { return change.addedNodes.length > 0 && !(change.addedNodes[0] instanceof Element && change.addedNodes[0].localName === 'see-strip'); })) return;
    clearTimeout(again);
    again = setTimeout(function () {
      if (tools.dye) { undye(); dyeAll(tools.dye.dyes.map(hexOf), hexOf(tools.dye.paper)); }
      if (tools.strips) strip();
      if (tools.pictures) ditherAll(tools.pictures.dyes.map(hexOf), tools.pictures.most);
    }, 700);
  }).observe(document, { childList: true, subtree: true });

  /* --- links and forms ------------------------------------------------------------------------------------------- */
  function whole(address) {
    try {
      var url = new URL(address, page);
      // A script that names a place by itself is read against this site, whose frame it is in; it meant the page's.
      if (url.origin === to) url = new URL(url.pathname + url.search + url.hash, page);
      return url.href;
    } catch (error) { return address; }
  }
  function jump(hash) {
    var name = hash.slice(1), spot = null;
    try { name = decodeURIComponent(name); } catch (error) { /* as written */ }
    if (name.length > 0) spot = document.getElementById(name) || document.getElementsByName(name)[0]; else spot = document.documentElement;
    if (spot) spot.scrollIntoView();
  }
  function pressed(event) {
    if (event.defaultPrevented || !event.isTrusted || (event.type === 'auxclick' && event.button !== 1)) return;
    var link = null, path = event.composedPath();
    for (var i = 0; i < path.length; i += 1) if (path[i] instanceof Element && path[i].matches('a[href], area[href]')) { link = path[i]; break; }
    if (!link) return;
    var address = link.getAttribute('href') || '';
    event.preventDefault();
    if (/^\s*javascript:/i.test(address)) {
      // Never followed: an answer in words would make a new window of the page. Run where an answer is nothing.
      if (config.scripts) { try { var code = decodeURIComponent(address.replace(/^\s*javascript:/i, '')); setTimeout(function () { (0, eval)(code); }, 0); } catch (error) { /* not a script */ } }
      return;
    }
    if (address.charAt(0) === '#') { jump(address); return; }
    say({ see: 'open', address: whole(address), newTab: event.type === 'auxclick' || event.ctrlKey || event.metaKey });
  }
  // On the way back up, so a page's own script that handles a press itself is let.
  window.addEventListener('click', pressed);
  window.addEventListener('auxclick', pressed);

  function send(form, button) {
    var method = ((button && button.getAttribute('formmethod')) || form.getAttribute('method') || 'get').toLowerCase();
    if (method !== 'get') { say({ see: 'form' }); return; }
    if (form.querySelector('[data-see-dead]')) { say({ see: 'form' }); return; }
    var data = new FormData(form), query = new URLSearchParams();
    if (button && button.name) data.append(button.name, button.value);
    data.forEach(function (value, name) { if (typeof value === 'string') query.append(name, value); });
    var url;
    try { url = new URL(whole(form.getAttribute('action') || page)); } catch (error) { return; }
    url.search = query.toString();
    say({ see: 'open', address: url.href, newTab: false });
  }
  function submit(form, button) {
    // The sandbox lets no form send itself, so the page is asked as a browser would ask it, and then we do it.
    var event = new Event('submit', { bubbles: true, cancelable: true });
    if (form.checkValidity && !form.noValidate && !form.checkValidity()) return;
    if (form.dispatchEvent(event)) send(form, button);
  }
  window.addEventListener('click', function (event) {
    if (event.defaultPrevented || !event.isTrusted) return;
    var button = event.target instanceof Element ? event.target.closest('button, input') : null;
    if (!button || !button.form || button.disabled) return;
    var type = (button.type || '').toLowerCase();
    if (type === 'submit' || type === 'image') { event.preventDefault(); submit(button.form, button); }
  });
  window.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || !event.isTrusted || event.key !== 'Enter' || event.isComposing) return;
    var field = event.target;
    if (!(field instanceof HTMLInputElement) || !field.form || /^(?:button|submit|image|reset|checkbox|radio|file|range|color)$/.test(field.type)) return;
    event.preventDefault();
    submit(field.form, field.form.querySelector('button:not([type]), button[type=submit], input[type=submit]'));
  });

  /* --- BILLBOARD -------------------------------------------------------------------------------------------------- */
  function hang(pieces) {
    if (pieces.length === 0) return;
    var boxes = document.querySelectorAll('[data-see-ad]'), used = 0;
    for (var i = 0; i < boxes.length && used < 12; i += 1) {
      var box = boxes[i], size = box.getBoundingClientRect();
      if (size.width < 120 || size.height < 50 || box.querySelector('[data-see-ad]') || (box.textContent || '').trim().length > 400) continue;
      (function (box, size, index) {
        var picture = document.createElement('img');
        picture.src = pieces[index].src;
        picture.alt = 'STREAM ART';
        picture.title = pieces[index].title;
        picture.setAttribute('style', 'display:block!important;width:100%!important;height:' + Math.round(Math.min(size.height, size.width * 0.75)) + 'px!important;object-fit:cover!important;image-rendering:pixelated!important;cursor:pointer!important');
        picture.addEventListener('click', function (event) { if (event.isTrusted) { event.preventDefault(); event.stopPropagation(); say({ see: 'art', index: index }); } });
        box.textContent = '';
        box.appendChild(picture);
      })(box, size, used % pieces.length);
      used += 1;
    }
  }

  function ready() { say({ see: 'ready', ads: document.querySelectorAll('[data-see-ad]').length > 0 }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  setTimeout(show, 1500);

  function dead(element) { if (element instanceof HTMLInputElement && element.type === 'password') { element.type = 'text'; element.disabled = true; element.value = ''; element.placeholder = 'NO SIGN-INS HERE'; element.setAttribute('data-see-dead', ''); } }
  if (!config.scripts) {
    new MutationObserver(function (changes) { changes.forEach(function (change) { if (change.type === 'attributes') dead(change.target); change.addedNodes.forEach(function (node) { if (node instanceof Element) { dead(node); node.querySelectorAll('input').forEach(dead); } }); }); }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] });
    return;
  }

  /* --- no frames, no links ------------------------------------------------------------------------------------------
     The one part of this that is a guard (see the top). It runs in the page's own window, where the page may put anything in place of any
     built-in, so it leans on none of them: what it needs is taken here, before the page has run, and nothing is looked up by name after. */
  var taken = Function.prototype.bind.bind(Function.prototype.call);
  var reach_ = Reflect.apply, text_ = String, lower = taken(String.prototype.toLowerCase), codeAt = taken(String.prototype.charCodeAt), cut = taken(String.prototype.slice), find = taken(String.prototype.indexOf), findLast = taken(String.prototype.lastIndexOf);
  var define_ = Object.defineProperty;
  var BARRED = { __proto__: null, iframe: 1, frame: 1, frameset: 1, object: 1, embed: 1, fencedframe: 1, portal: 1, link: 1 };
  // Own data properties on an object with no prototype: nothing the page defines on Object.prototype is asked.
  function barred(name) {
    name = lower(name);
    var colon = findLast(name, ':');
    if (colon !== -1) name = cut(name, colon + 1);
    return BARRED[name] === 1;
  }
  function isLetter(code) { return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57); }
  // After each opening or closing angle (and in XML after a prefix's colon), a barred name becomes another name.
  function noFrames(text, xml) {
    var out = '', from = 0, at = find(text, '<', 0), end, name;
    while (at !== -1) {
      var start = at + 1;
      if (codeAt(text, start) === 47) start += 1;
      end = start;
      while (end < text.length && (isLetter(codeAt(text, end)) || (xml && (codeAt(text, end) === 58 || codeAt(text, end) === 45 || codeAt(text, end) === 95 || codeAt(text, end) === 46 || codeAt(text, end) > 127)))) end += 1;
      name = cut(text, start, end);
      if (name !== '' && barred(name)) { out += cut(text, from, start) + 'see-' + (xml ? cut(name, findLast(name, ':') + 1) : name); from = end; }
      at = find(text, '<', at + 1);
    }
    return from === 0 && out === '' ? text : out + cut(text, from);
  }
  // Tags cut in two across two writes are put back together before they are read.
  var rest = '';
  function markup(text, type, sink) {
    text = text_(text);
    sink = lower(text_(sink === undefined ? '' : sink));
    if (find(sink, 'write', 0) !== -1) {
      text = rest + text;
      var open = findLast(text, '<');
      if (open !== -1 && find(text, '>', open) === -1) { rest = cut(text, open); text = cut(text, 0, open); } else rest = '';
    }
    var low = lower(text);
    // A page written as XML can spell a tag in ways only its own rules can read.
    if (find(low, '<!entity', 0) !== -1) return '';
    return noFrames(text, find(low, 'xmlns', 0) !== -1);
  }
  // An address that is a script makes a new window of the page when it answers with words, with everything back in it. Pressed links of that
  // kind are run by us instead, where an answer is nothing.
  function script(text, type, sink) {
    sink = lower(text_(sink === undefined ? '' : sink));
    return find(sink, 'location', 0) !== -1 || find(sink, 'href', 0) !== -1 || find(sink, 'action', 0) !== -1 || find(sink, 'src', 0) !== -1 && find(sink, 'script', 0) === -1 ? null : text;
  }
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    window.trustedTypes.createPolicy('default', { createHTML: markup, createScript: script, createScriptURL: function (text) { return text; } });
  }
  var make = Document.prototype.createElement, makeIn = Document.prototype.createElementNS, makeDocument = DOMImplementation.prototype.createDocument, addClass = CustomElementRegistry.prototype.define;
  function replaced(name) { if (lower(name) !== 'link') restrict(); return 'see-' + cut(lower(name), findLast(name, ':') + 1); }
  // Arguments are handed on in a list made here, its places its own.
  function list(a, b, c) { var all = { __proto__: null, length: 0 }; all.length = c === undefined ? (b === undefined ? 1 : 2) : 3; all[0] = a; all[1] = b; all[2] = c; return all; }
  define_(Document.prototype, 'createElement', { __proto__: null, configurable: true, writable: true, enumerable: true, value: function createElement(name) {
    name = text_(name);
    if (!barred(name)) return reach_(make, this, list(name));
    var made = reach_(make, this, list(replaced(name)));
    if (lower(name) === 'link') pretendLink(made);
    return made;
  } });
  define_(Document.prototype, 'createElementNS', { __proto__: null, configurable: true, writable: true, enumerable: true, value: function createElementNS(space, name) {
    name = text_(name);
    if (!barred(name)) return reach_(makeIn, this, list(space === null || space === undefined ? null : text_(space), name));
    return reach_(makeIn, this, list('http://www.w3.org/1999/xhtml', replaced(name)));
  } });
  define_(DOMImplementation.prototype, 'createDocument', { __proto__: null, configurable: true, writable: true, enumerable: true, value: function createDocument(space, name) {
    name = name === null || name === undefined ? '' : text_(name);
    return reach_(makeDocument, this, list(space === null || space === undefined ? null : text_(space), barred(name) ? replaced(name) : name, null));
  } });
  // No class is made an element of another kind: an element that is a frame by its class is a frame.
  define_(CustomElementRegistry.prototype, 'define', { __proto__: null, configurable: true, writable: true, enumerable: true, value: function define(name, type) { return reach_(addClass, this, list(text_(name), type)); } });
  // Newer ways of writing markup that no policy is asked about.
  [Element.prototype, window.ShadowRoot && ShadowRoot.prototype, Document, Document.prototype, window.DocumentFragment && DocumentFragment.prototype].forEach(function (type) {
    if (type) Object.getOwnPropertyNames(type).forEach(function (name) { if (/^(?:setHTML|parseHTML|stream|appendHTML|prependHTML|beforeHTML|afterHTML|replaceWithHTML)/.test(name)) { try { delete type[name]; } catch (error) { /* a policy is asked about it */ } } });
  });
  Object.getOwnPropertyNames(window).forEach(function (name) { if (/^(?:RTC|webkitRTC|XSLTProcessor|WebTransport)/.test(name)) { try { delete window[name]; } catch (error) { /* replaced below */ } } });

  // A stylesheet a script links to: an element that says it is a link, and a style that imports the signed sheet in its place.
  function pretendLink(element) {
    ['rel', 'href', 'media', 'type', 'as'].forEach(function (name) {
      define_(element, name, { configurable: true, get: function () { return element.getAttribute(name) || ''; }, set: function (value) { element.setAttribute(name, value); } });
    });
    define_(element, 'sheet', { configurable: true, get: function () { return null; } });
  }
  function joinLink(element) {
    var rel = element.getAttribute('rel') || '', href = element.getAttribute('href');
    if (href === null || !/(?:^|\s)stylesheet(?:\s|$)/i.test(rel) || element.hasAttribute('data-see-joined')) return;
    element.setAttribute('data-see-joined', '');
    seal(href, 'style').then(function (answer) {
      if (!answer) { element.dispatchEvent(new Event('error')); return; }
      var style = document.createElement('style');
      if (element.getAttribute('media')) style.setAttribute('media', element.getAttribute('media'));
      style.textContent = '@import url("' + answer + '");';
      if (element.parentNode) element.parentNode.insertBefore(style, element.nextSibling);
      setTimeout(function () { element.dispatchEvent(new Event('load')); }, 150);
    });
  }

  /* --- what a page's scripts expect to find ------------------------------------------------------------------------ */
  function put(target, name, value) { try { Object.defineProperty(target, name, { value: value, configurable: true, writable: true }); } catch (error) { /* kept as it was */ } }
  function store() {
    var held = new Map();
    return new Proxy({
      getItem: function (key) { key = String(key); return held.has(key) ? held.get(key) : null; },
      setItem: function (key, value) { if (held.size < 2000) held.set(String(key), String(value).slice(0, 200000)); },
      removeItem: function (key) { held.delete(String(key)); },
      clear: function () { held.clear(); },
      key: function (index) { return Array.from(held.keys())[index] || null; }
    }, {
      get: function (own, key) { if (key === 'length') return held.size; if (key in own) return own[key]; return typeof key === 'string' && held.has(key) ? held.get(key) : undefined; },
      set: function (own, key, value) { own.setItem(key, value); return true; },
      deleteProperty: function (own, key) { held.delete(String(key)); return true; },
      has: function (own, key) { return key in own || held.has(String(key)); }
    });
  }
  put(window, 'localStorage', store());
  put(window, 'sessionStorage', store());
  var cookies = new Map();
  try {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function () { return Array.from(cookies, function (each) { return each[0] + '=' + each[1]; }).join('; '); },
      set: function (text) { var part = String(text).split(';')[0], at = part.indexOf('='); if (at > 0 && cookies.size < 100) cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim()); }
    });
  } catch (error) { /* left refusing */ }
  // Where the page is, as far as it may know: its own address, which its own pushState moves, and going anywhere is asked of the site.
  var here = new URL(page);
  function leave(address) {
    var url;
    try { url = new URL(String(address), here); } catch (error) { return; }
    if (url.href.split('#')[0] === here.href.split('#')[0] && url.hash) { here = url; jump(url.hash); return; }
    if (/^https?:$/.test(url.protocol)) say({ see: 'open', address: url.href, newTab: false });
  }
  var place = { assign: leave, replace: leave, reload: function () {}, toString: function () { return here.href; }, valueOf: function () { return here.href; }, ancestorOrigins: { length: 0, contains: function () { return false; }, item: function () { return null; } } };
  ['href', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'].forEach(function (name) {
    Object.defineProperty(place, name, { enumerable: true, get: function () { return here[name]; }, set: function (value) { var next = new URL(here); if (name === 'href') { leave(value); return; } next[name] = value; leave(next.href); } });
  });
  Object.defineProperty(place, 'origin', { enumerable: true, get: function () { return here.origin; } });
  Object.defineProperty(window, '__seeLocation', { configurable: false, get: function () { return place; }, set: leave });
  ['URL', 'documentURI', 'baseURI'].forEach(function (name) { try { Object.defineProperty(document, name, { configurable: true, get: function () { return here.href; } }); } catch (error) { /* as it is */ } });
  try { Object.defineProperty(document, 'referrer', { configurable: true, get: function () { return ''; } }); Object.defineProperty(document, 'domain', { configurable: true, get: function () { return here.hostname; }, set: function () {} }); } catch (error) { /* as they are */ }
  ['pushState', 'replaceState'].forEach(function (name) {
    var own = history[name].bind(history);
    history[name] = function (state, title, address) { if (address !== undefined && address !== null) { try { var next = new URL(String(address), here); if (next.origin === here.origin) here = next; } catch (error) { /* as it was */ } } try { own(state, ''); } catch (error) { /* not here */ } };
  });

  function Refused(name) { return function () { restrict(); throw new DOMException(name + ' is not available here', 'NotSupportedError'); }; }
  ['Worker', 'SharedWorker', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'].forEach(function (name) { if (name in window) put(window, name, Refused(name)); });
  try { put(navigator, 'sendBeacon', function () { restrict(); return true; }); } catch (error) { /* kept */ }
  try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: function () { return undefined; } }); } catch (error) { /* kept */ }
  put(window, 'open', function (address) { restrict(); if (address && navigator.userActivation && navigator.userActivation.isActive) say({ see: 'open', address: whole(String(address)), newTab: true }); return null; });

  /* fetch and XMLHttpRequest, asked of the site */
  function reach(input, method) {
    var address = whole(typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url ? input.url : String(input));
    if (!/^https?:/i.test(address)) return Promise.resolve(null);
    if (method !== 'GET') { restrict(); return Promise.resolve(null); }
    return ask({ see: 'ask', address: address });
  }
  var ownFetch = window.fetch;
  put(window, 'fetch', function (input, init) {
    var address = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    if (/^(?:data|blob):/i.test(String(address))) return ownFetch.call(window, input, init);
    var method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    return reach(input, method).then(function (answer) {
      if (!answer || !answer.ok) throw new TypeError('Failed to fetch');
      var empty = answer.status === 204 || answer.status === 205 || answer.status === 304;
      var response = new Response(empty ? null : answer.body, { status: answer.status, headers: { 'content-type': answer.type } });
      try { Object.defineProperty(response, 'url', { value: answer.url }); } catch (error) { /* as it is */ }
      return response;
    });
  });

  function Xhr() {
    var target = document.createDocumentFragment(), self = this, method = 'GET', address = '', stopped = false, headers = '';
    this.readyState = 0; this.status = 0; this.statusText = ''; this.responseType = ''; this.response = ''; this.responseText = ''; this.responseXML = null; this.responseURL = ''; this.timeout = 0; this.withCredentials = false;
    this.upload = document.createDocumentFragment();
    ['addEventListener', 'removeEventListener', 'dispatchEvent'].forEach(function (name) { self[name] = target[name].bind(target); });
    function happen(name) {
      var event = new Event(name);
      if (typeof self['on' + name] === 'function') { try { self['on' + name].call(self, event); } catch (error) { setTimeout(function () { throw error; }); } }
      target.dispatchEvent(event);
    }
    function move(state) { self.readyState = state; happen('readystatechange'); }
    this.open = function (how, where) { method = String(how).toUpperCase(); address = where; stopped = false; move(1); };
    this.setRequestHeader = function () {};
    this.overrideMimeType = function () {};
    this.getResponseHeader = function (name) { return /^content-type$/i.test(name) ? headers || null : null; };
    this.getAllResponseHeaders = function () { return headers ? 'content-type: ' + headers + '\r\n' : ''; };
    this.abort = function () { stopped = true; happen('abort'); happen('loadend'); };
    this.send = function () {
      happen('loadstart');
      reach(address, method).then(function (answer) {
        if (stopped) return;
        if (!answer || !answer.ok) { self.readyState = 4; happen('readystatechange'); happen('error'); happen('loadend'); return; }
        headers = answer.type; self.status = answer.status; self.statusText = answer.status === 200 ? 'OK' : ''; self.responseURL = answer.url;
        move(2); move(3);
        var text = self.responseType === '' || self.responseType === 'text' || self.responseType === 'json' || self.responseType === 'document' ? new TextDecoder().decode(answer.body) : '';
        if (self.responseType === 'arraybuffer') self.response = answer.body;
        else if (self.responseType === 'blob') self.response = new Blob([answer.body], { type: answer.type });
        else if (self.responseType === 'json') { try { self.response = JSON.parse(text); } catch (error) { self.response = null; } }
        else if (self.responseType === 'document') self.response = new DOMParser().parseFromString(text, 'text/html');
        else { self.responseText = text; self.response = text; }
        move(4); happen('load'); happen('loadend');
      });
    };
  }
  Xhr.UNSENT = 0; Xhr.OPENED = 1; Xhr.HEADERS_RECEIVED = 2; Xhr.LOADING = 3; Xhr.DONE = 4;
  Xhr.prototype = { UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4, constructor: Xhr };
  put(window, 'XMLHttpRequest', Xhr);

  /* files a script puts on the page: held until the site has signed them */
  var queue = [], timer = 0;
  function flush() {
    timer = 0;
    var batch = queue.splice(0, 50);
    ask({ see: 'seal', files: batch.map(function (each) { return { address: each.address, kind: each.kind }; }) }).then(function (answer) {
      batch.forEach(function (each, index) { each.done(answer.ok && answer.addresses ? answer.addresses[index] : null); });
    });
    if (queue.length > 0) timer = setTimeout(flush, 0);
  }
  function seal(address, kind) {
    return new Promise(function (done) { queue.push({ address: whole(address), kind: kind, done: done }); if (!timer) timer = setTimeout(flush, 0); });
  }
  function near(address) { return address === '' || address.indexOf(config.assets) === 0 || /^(?:data|blob|about|javascript):/i.test(address) || address.charAt(0) === '#'; }
  function kindOf(element, name) {
    if (element instanceof HTMLScriptElement) return name === 'src' ? (element.type === 'module' ? 'module' : 'script') : null;
    if (element instanceof HTMLImageElement || element instanceof HTMLSourceElement || element instanceof HTMLInputElement) return name === 'src' ? 'picture' : name === 'srcset' ? 'set' : null;
    if (element instanceof HTMLVideoElement) return name === 'poster' ? 'picture' : null;
    return null;
  }
  var ownSet = Element.prototype.setAttribute, meant = new WeakMap();
  function remember(element, name, value) { var all = meant.get(element) || {}; all[name] = value; meant.set(element, all); }
  function later(element, name, value) {
    var kind = kindOf(element, name);
    if (kind === null) return false;
    value = String(value);
    if (kind === 'set') {
      var parts = value.split(/,\s+/).map(function (each) { var bits = each.trim().split(/\s+/); return { address: bits[0], size: bits.slice(1).join(' ') }; }).filter(function (each) { return each.address; }).slice(0, 12);
      if (parts.length === 0 || parts.every(function (each) { return near(each.address); })) return false;
      remember(element, name, value);
      Promise.all(parts.map(function (each) { return near(each.address) ? each.address : seal(each.address, 'picture'); })).then(function (all) {
        if (meant.get(element)[name] !== value) return;
        var out = parts.map(function (each, index) { return all[index] ? all[index] + (each.size ? ' ' + each.size : '') : ''; }).filter(Boolean).join(', ');
        if (out) ownSet.call(element, name, out);
      });
      return true;
    }
    if (near(value.trim())) return false;
    remember(element, name, value);
    seal(value.trim(), kind).then(function (answer) {
      if (meant.get(element)[name] !== value) return;
      if (answer) ownSet.call(element, name, answer); else element.dispatchEvent(new Event('error'));
    });
    return true;
  }
  Element.prototype.setAttribute = function (name, value) {
    var plain = String(name).toLowerCase();
    if (plain === 'integrity' || plain === 'crossorigin' || plain === 'nonce') return;
    if ((plain === 'src' || plain === 'srcset' || plain === 'href' || plain === 'poster') && later(this, plain, value)) return;
    ownSet.call(this, name, value);
  };
  function watchProperty(type, name) {
    var own = type && Object.getOwnPropertyDescriptor(type.prototype, name);
    if (!own || !own.set) return;
    Object.defineProperty(type.prototype, name, {
      configurable: true, enumerable: own.enumerable,
      get: function () { var all = meant.get(this); return all && all[name] !== undefined && name !== 'srcset' ? whole(all[name]) : own.get.call(this); },
      set: function (value) { if (!later(this, name, value)) own.set.call(this, value); }
    });
  }
  watchProperty(window.HTMLScriptElement, 'src'); watchProperty(window.HTMLImageElement, 'src'); watchProperty(window.HTMLImageElement, 'srcset');
  watchProperty(window.HTMLSourceElement, 'srcset'); watchProperty(window.HTMLVideoElement, 'poster');
  ['integrity', 'crossOrigin', 'nonce'].forEach(function (name) {
    [window.HTMLScriptElement, window.HTMLImageElement].forEach(function (type) { try { if (type && name in type.prototype) Object.defineProperty(type.prototype, name, { configurable: true, get: function () { return ''; }, set: function () {} }); } catch (error) { /* kept */ } });
  });

  /* what a script puts on the page to play: said, never loaded (the policy lets no media load) */
  var played = {}, mediaTimer = 0;
  function notePlayed(element, address) {
    if (address === '' || (/^[a-z][a-z0-9+.-]*:/i.test(address) && !/^https?:/i.test(address)) || Object.keys(played).length >= 20) return;
    var at = whole(address);
    if (!/^https?:/.test(at) || played[at]) return;
    played[at] = { address: at, title: (element.getAttribute('title') || element.getAttribute('aria-label') || document.title || '').slice(0, 160), from: element.localName === 'audio' ? 'audio' : 'video', seconds: 0 };
    if (!mediaTimer) mediaTimer = setTimeout(function () { mediaTimer = 0; say({ see: 'media', media: Object.keys(played).map(function (key) { return played[key]; }) }); }, 400);
  }
  var ownMediaSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (ownMediaSrc && ownMediaSrc.set) Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, enumerable: true, get: function () { return ownMediaSrc.get.call(this); }, set: function (value) { notePlayed(this, String(value)); ownMediaSrc.set.call(this, value); } });

  // What came in as markup (innerHTML), which no setter sees.
  function look(element) {
    if (!(element instanceof Element)) return;
    ['src', 'srcset', 'poster'].forEach(function (name) { var value = element.getAttribute(name); if (value !== null && kindOf(element, name) && !(element instanceof HTMLScriptElement)) later(element, name, value); });
    if (element.localName === 'see-link') joinLink(element);
    if (element instanceof HTMLMediaElement || element instanceof HTMLSourceElement) { var plays = element.getAttribute('src'); if (plays !== null && (element instanceof HTMLMediaElement || (element.parentNode instanceof HTMLMediaElement))) notePlayed(element, plays); }
    dead(element);
  }
  new MutationObserver(function (changes) {
    changes.forEach(function (change) {
      if (change.type === 'attributes') { look(change.target); return; }
      change.addedNodes.forEach(function (node) {
        if (!(node instanceof Element)) return;
        look(node);
        node.querySelectorAll('img, source, see-link, video, audio, input').forEach(look);
      });
    });
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'type', 'href', 'rel'] });

})`;

/*
 * The lenses, put on a page the reader has asked to see through them: in the machine's frame, or in an ordinary tab. Run in the extension's own
 * world, beside the page's scripts and out of their reach. It changes how the page looks and reads nothing but what it shows; what it finds
 * (media, watchers) is answered to the extension and goes no further without a press.
 */
globalThis.debaserSee ??= (() => {
  const MARK = 'debaser-see';
  let sheet = null;
  let cover = null;
  let rules = [];

  function off() {
    sheet?.remove();
    cover?.remove();
    for (const [root, made] of rules) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((each) => each !== made);
    sheet = null;
    cover = null;
    rules = [];
  }
  /*
   * Run as the page itself (the bookmarks-bar key, not the extension), rules go on as a sheet object: a page's own content policy forbids
   * style elements, and is told of each one tried. The extension, out of the page's reach, uses an element as it always did.
   */
  const AS_PAGE = globalThis.chrome?.runtime?.id === undefined && globalThis.browser?.runtime?.id === undefined;
  function styled(root, css) {
    if (AS_PAGE) {
      try {
        const made = new CSSStyleSheet();
        made.replaceSync(css);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, made];
        rules.push([root, made]);
        return null;
      } catch {
        // A browser without sheet objects: an element, where the page lets one be.
      }
    }
    const style = document.createElement('style');
    style.textContent = css;
    return style;
  }
  function dress(css) {
    sheet = styled(document, css);
    if (sheet === null) return;
    sheet.id = MARK;
    document.documentElement.append(sheet);
  }

  /* READER: the element most of the writing is in, its words copied into a page of our own over the top. */
  const FURNITURE = /(?:^|[\s_-])(?:nav|navbar|navigation|menu|sidebar|footer|masthead|breadcrumbs?|share|sharing|social|related|recommended|promo|newsletter|subscribe|cookie|consent|banner|comments?|advert|ads?|sponsored|toolbar|popup|modal)(?=$|[\s_\d-])/i;
  const named = (each) => `${each.id} ${typeof each.className === 'string' ? each.className : ''}`;
  const furniture = (each) => /^(?:NAV|ASIDE|FOOTER|FORM|BUTTON|SCRIPT|STYLE|NOSCRIPT|IFRAME|DIALOG)$/.test(each.tagName) || each.hidden || each.getAttribute('aria-hidden') === 'true' || (!/^(?:ARTICLE|MAIN|BODY)$/.test(each.tagName) && FURNITURE.test(named(each)));
  function main() {
    const scores = new Map();
    for (const each of document.querySelectorAll('p, pre, blockquote, td')) {
      const words = (each.textContent.match(/\S+/g) ?? []).length;
      if (words < 8 || each.closest('nav, aside, footer, form')) continue;
      const linked = [...each.querySelectorAll('a')].reduce((sum, link) => sum + (link.textContent.match(/\S+/g) ?? []).length, 0);
      const points = Math.min(words / 20, 8) * (1 - linked / words);
      let at = each.parentElement;
      for (let share = 1; at !== null && share > 0.2; share /= 2, at = at.parentElement) scores.set(at, (scores.get(at) ?? 0) + points * share);
    }
    let best = null;
    let most = 0;
    for (const [each, points] of scores) if (points > most) [best, most] = [each, points];
    return best;
  }
  const KEPT = /^(?:P|H[1-6]|UL|OL|LI|DL|DT|DD|BLOCKQUOTE|PRE|CODE|FIGURE|FIGCAPTION|TABLE|THEAD|TBODY|TR|TD|TH|B|STRONG|I|EM|SUB|SUP|SMALL|BR|HR|Q|CITE|TIME)$/;
  function copy(from, to) {
    for (const child of from.childNodes) {
      if (child.nodeType === 3) to.append(child.nodeValue);
      else if (child.nodeType === 1 && !furniture(child)) {
        if (child.tagName === 'IMG') {
          if (!child.currentSrc || child.width < 40) continue;
          const picture = document.createElement('img');
          picture.src = child.currentSrc;
          picture.alt = child.alt;
          to.append(picture);
        } else if (child.tagName === 'A' && /^https?:/.test(child.href)) {
          const link = document.createElement('a');
          link.href = child.href;
          to.append(link);
          copy(child, link);
        } else if (KEPT.test(child.tagName)) {
          const made = document.createElement(child.tagName === 'H1' ? 'H2' : child.tagName);
          to.append(made);
          copy(child, made);
        } else copy(child, to);
      }
    }
  }
  function reader(theme) {
    const from = main();
    if (from === null) return 'NO MAIN TEXT FOUND.';
    cover = document.createElement('div');
    const shadow = cover.attachShadow({ mode: 'closed' });
    const style = styled(shadow, `:host{all:initial;position:fixed;inset:0;z-index:2147483647;overflow:auto;background:${theme.paper};color:${theme.ink};font:18px/1.6 'IBM Plex Mono','Courier New',monospace}main{max-width:42rem;margin:0 auto;padding:1.5rem;overflow-wrap:break-word}h1,h2,h3,h4{font-weight:400;line-height:1.25}a{color:${theme.accent}}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin-left:0;padding-left:1rem;border-left:2px solid ${theme.ink}}td,th{border:1px solid ${theme.ink};padding:.25rem .5rem;text-align:left;font-weight:400}`);
    const page = document.createElement('main');
    const title = document.createElement('h1');
    title.textContent = (document.querySelector('h1')?.textContent ?? document.title).trim();
    page.append(title);
    copy(from, page);
    if (style !== null) shadow.append(style);
    shadow.append(page);
    document.documentElement.append(cover);
    return null;
  }

  function put(lens, theme) {
    off();
    if (lens === 'reader') return reader(theme);
    if (lens === 'xray') dress(`p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote{outline:1px dotted ${theme.accent}!important}a[href]{outline:1px solid ${theme.sun}!important}img,svg,video,canvas{outline:1px solid ${theme.fault}!important}iframe{outline:2px dashed ${theme.fault}!important}form,input,button,select,textarea{outline:1px dashed ${theme.accent}!important}`);
    if (lens === 'lowfi') dress(`*,*::before,*::after{background-color:transparent!important;color:${theme.ink}!important;border-color:${theme.ink}!important;border-radius:0!important;box-shadow:none!important;text-shadow:none!important;font-family:'IBM Plex Mono','Courier New',monospace!important}*:not(img){background-image:none!important}html,body{background-color:${theme.paper}!important}a,a *{color:${theme.accent}!important;text-decoration:underline!important}img,video{image-rendering:pixelated!important;filter:grayscale(1) contrast(1.4)!important}`);
    if (lens === 'yours') dress(`*{color:${theme.ink}!important;background-color:${theme.paper}!important;border-color:${theme.ink}!important}a,a *{color:${theme.accent}!important}`);
    return null;
  }

  /* What the page plays, as it says it; nothing is fetched. */
  function media() {
    const found = new Map();
    const add = (address, title) => {
      try {
        const url = new URL(address, location.href);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && found.size < 40 && !found.has(url.href)) found.set(url.href, String(title ?? '').trim().slice(0, 160) || document.title.slice(0, 160));
      } catch {
        // Not an address.
      }
    };
    const MEDIA = /\.(?:mp4|m4v|webm|mov|ogv|m3u8|mpd)(?:[?#]|$)/i;
    const PLATFORM = /^https:\/\/(?:(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:watch\?|embed\/|live\/|shorts\/)|youtu\.be\/|(?:www\.|player\.)?vimeo\.com\/(?:video\/)?\d|(?:www\.)?twitch\.tv\/videos\/\d)/i;
    if (PLATFORM.test(location.href)) add(location.href, document.title);
    for (const each of document.querySelectorAll('video[src], audio[src], video source[src]')) add(each.src, each.title);
    for (const each of document.querySelectorAll('meta[property^="og:video"]')) add(each.content, document.title);
    for (const each of document.querySelectorAll('iframe[src]')) if (PLATFORM.test(each.src)) add(each.src, each.title);
    for (const each of document.querySelectorAll('a[href]')) if (MEDIA.test(each.href) || PLATFORM.test(each.href)) add(each.href, each.textContent);
    return [...found].map(([address, title]) => ({ address, title }));
  }

  /* Who else the page spoke to: hosts and no more. */
  function watchers() {
    const own = location.hostname.split('.').slice(-2).join('.');
    const hosts = new Map();
    for (const entry of performance.getEntriesByType('resource')) {
      try {
        const host = new URL(entry.name).hostname;
        if (host !== '' && !host.endsWith(own)) hosts.set(host, (hosts.get(host) ?? 0) + 1);
      } catch {
        // Not an address.
      }
    }
    return [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([host, count]) => ({ host, count }));
  }

  return { put, off, media, watchers };
})();

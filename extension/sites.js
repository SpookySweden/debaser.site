/*
 * Which sites the machine may act on: the ones the reader has let it, one press each, and never the ones below.
 *
 * NEVER FRAMED (SPEC-seeing-machine.md, D1): sign-ins, banks and payments. Showing a site in a frame means lifting its no-framing header, which
 * takes away its protection against disguised clicks, so these are only ever opened in an ordinary tab. The same list the server's eye refuses
 * (app/lib/seeing/server/sign-ins.ts); Temp/check-see-extension.cjs holds the two together.
 */
export const NEVER_HOSTS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'myaccount.google.com',
  'oauth2.googleapis.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.microsoft.com',
  'account.microsoft.com',
  'account.live.com',
  'appleid.apple.com',
  'idmsa.apple.com',
  'account.apple.com',
  'login.yahoo.com',
  'auth.services.adobe.com',
  'login.salesforce.com',
  'id.twitch.tv',
  'accounts.spotify.com',
  'auth.riotgames.com',
  'authenticate.riotgames.com',
  'account.riotgames.com',
  'login.steampowered.com',
  'signin.aws.amazon.com',
  'signin.ebay.com',
  'signin.ebay.co.uk',
  'www.paypal.com',
  'paypal.com',
  'checkout.stripe.com',
  'dashboard.stripe.com',
  'auth.openai.com',
  'login.wikimedia.org',
  'auth.wikimedia.org',
  'account.proton.me',
  'mail.proton.me',
  'vault.bitwarden.com',
  'my.1password.com',
  'login.tailscale.com',
  'dash.cloudflare.com',
  'vercel.com/login',
  'github.com/login',
  'github.com/session',
  'gitlab.com/users',
  'www.facebook.com/login',
  'm.facebook.com/login',
  'www.instagram.com/accounts',
  'x.com/i/flow',
  'x.com/login',
  'twitter.com/login',
  'www.linkedin.com/login',
  'www.linkedin.com/checkpoint',
  'www.reddit.com/login',
  'old.reddit.com/login',
  'discord.com/login',
  'www.amazon.co.uk/ap',
  'www.amazon.com/ap',
];
export const NEVER_NAMES = [
  'okta.com',
  'oktapreview.com',
  'auth0.com',
  'onelogin.com',
  'duosecurity.com',
  'b2clogin.com',
  'ping-eng.com',
  'pingidentity.com',
  'barclays.co.uk',
  'hsbc.co.uk',
  'lloydsbank.co.uk',
  'lloydsbank.com',
  'natwest.com',
  'nwolb.com',
  'rbs.co.uk',
  'santander.co.uk',
  'halifax.co.uk',
  'halifax-online.co.uk',
  'nationwide.co.uk',
  'monzo.com',
  'starlingbank.com',
  'revolut.com',
  'tsb.co.uk',
  'firstdirect.com',
  'co-operativebank.co.uk',
  'wise.com',
];

/** Names that are many people's: under one of these, a site is the name one further in. */
const SHARED = ['github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'blogspot.com', 'wordpress.com', 'tumblr.com', 'substack.com', 'neocities.org', 'itch.io', 'glitch.me', 'repl.co', 'replit.app', 'onrender.com', 'fly.dev', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'myshopify.com', 'surge.sh', 'deno.dev', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'medium.com', 'livejournal.com', 'weebly.com', 'wixsite.com', 'bandcamp.com', 'carrd.co', 'notion.site', 'github.dev', 'githubusercontent.com'];

/** The last two names of a host, or three for the common second-level endings and the shared ones; an address in numbers is itself. */
export function siteOf(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  const shared = SHARED.find((each) => host === each || host.endsWith('.' + each));
  if (shared !== undefined && host !== shared) return parts.slice(-(shared.split('.').length + 1)).join('.');
  const three = parts.length > 2 && /^(?:co|com|org|net|ac|gov|edu|ne|or|go)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(three ? -3 : -2).join('.');
}

export function neverFramed(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return true;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (NEVER_NAMES.some((name) => host === name || host.endsWith('.' + name))) return true;
  const path = url.pathname.toLowerCase();
  return NEVER_HOSTS.some((entry) => {
    const slash = entry.indexOf('/');
    return slash === -1 ? host === entry : host === entry.slice(0, slash) && (path === entry.slice(slash) || path.startsWith(entry.slice(slash) + '/'));
  });
}

/** What was typed, as an address: http or https, no name or password in it, never a page of this browser's own. */
export function readAddress(text) {
  const typed = String(text).trim();
  if (typed === '' || typed.length > 4000 || /\s/.test(typed)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i.exec(typed)?.[1].toLowerCase();
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') return null;
  try {
    const url = new URL(scheme === undefined ? 'https://' + typed : typed);
    if (url.username !== '' || url.password !== '' || !url.hostname.includes('.')) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The leave asked for one site: its name and everything under it, so a page that moves to www. still opens. */
export const originsOf = (site) => (/^[\d.]+$/.test(site) ? ['https://' + site + '/*', 'http://' + site + '/*'] : ['https://' + site + '/*', 'https://*.' + site + '/*', 'http://' + site + '/*', 'http://*.' + site + '/*']);

export async function allowedSites() {
  const all = await chrome.permissions.getAll();
  const sites = new Set();
  for (const origin of all.origins ?? []) {
    const host = /^https:\/\/(?:\*\.)?([^/*]+)\//.exec(origin)?.[1];
    if (host !== undefined) sites.add(siteOf(host));
  }
  return [...sites].sort();
}

export const isAllowed = async (address) => chrome.permissions.contains({ origins: ['https://' + siteOf(new URL(address).hostname) + '/*'] });

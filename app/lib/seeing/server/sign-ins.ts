/**
 * Sign-in pages (SPEC-seeing-machine.md, D1: never proxied, whatever else changes). A host here is refused outright, on every redirect; a
 * password box anywhere else is dead in the page and says so. SERVER ONLY.
 */
export const SIGN_IN_HOSTS = [
  'accounts.google.com', 'accounts.youtube.com', 'myaccount.google.com', 'oauth2.googleapis.com',
  'login.microsoftonline.com', 'login.live.com', 'login.microsoft.com', 'account.microsoft.com', 'account.live.com',
  'appleid.apple.com', 'idmsa.apple.com', 'account.apple.com',
  'login.yahoo.com', 'auth.services.adobe.com', 'login.salesforce.com',
  'id.twitch.tv', 'accounts.spotify.com', 'auth.riotgames.com', 'authenticate.riotgames.com', 'account.riotgames.com', 'login.steampowered.com',
  'signin.aws.amazon.com', 'signin.ebay.com', 'signin.ebay.co.uk', 'www.paypal.com', 'paypal.com', 'checkout.stripe.com', 'dashboard.stripe.com',
  'auth.openai.com', 'login.wikimedia.org', 'auth.wikimedia.org', 'account.proton.me', 'mail.proton.me', 'vault.bitwarden.com', 'my.1password.com',
  'login.tailscale.com', 'dash.cloudflare.com', 'vercel.com/login', 'github.com/login', 'github.com/session', 'gitlab.com/users',
  'www.facebook.com/login', 'm.facebook.com/login', 'www.instagram.com/accounts', 'x.com/i/flow', 'x.com/login', 'twitter.com/login', 'www.linkedin.com/login',
  'www.linkedin.com/checkpoint', 'www.reddit.com/login', 'old.reddit.com/login', 'discord.com/login', 'www.amazon.co.uk/ap', 'www.amazon.com/ap',
] as const;

export const SIGN_IN_NAMES = ['okta.com', 'oktapreview.com', 'auth0.com', 'onelogin.com', 'duosecurity.com', 'b2clogin.com', 'ping-eng.com', 'pingidentity.com'] as const;

/** Banks, by the names people in the UK would type; never read here at all. */
export const BANKS = ['barclays.co.uk', 'hsbc.co.uk', 'lloydsbank.co.uk', 'lloydsbank.com', 'natwest.com', 'nwolb.com', 'rbs.co.uk', 'santander.co.uk', 'halifax.co.uk', 'halifax-online.co.uk', 'nationwide.co.uk', 'monzo.com', 'starlingbank.com', 'revolut.com', 'tsb.co.uk', 'firstdirect.com', 'co-operativebank.co.uk', 'wise.com'] as const;

const REASON = 'SIGN-IN PAGES ARE NEVER SHOWN HERE';

export function refusesSignIn(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if ([...SIGN_IN_NAMES, ...BANKS].some((name) => host === name || host.endsWith(`.${name}`))) return REASON;
  const path = url.pathname.toLowerCase();
  for (const entry of SIGN_IN_HOSTS) {
    const slash = entry.indexOf('/');
    if (slash === -1 ? host === entry : host === entry.slice(0, slash) && (path === entry.slice(slash) || path.startsWith(`${entry.slice(slash)}/`))) return REASON;
  }
  return null;
}

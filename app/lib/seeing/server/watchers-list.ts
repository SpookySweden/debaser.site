/**
 * Known ad servers and trackers, by the company behind them (SPEC-seeing-machine.md, WATCHERS): refused in every lens, and said. Written by
 * hand from what is publicly known; not complete, and not meant to be. A name here covers everything under it. SERVER ONLY.
 *
 * `ad` marks the ones whose box on the page is an advertisement's, for BILLBOARD.
 */
type Company = { company: string; ad: readonly string[]; watch: readonly string[] };

const COMPANIES: readonly Company[] = [
  { company: 'Google', ad: ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'adtrafficquality.google', '2mdn.net', 'imasdk.googleapis.com'], watch: ['google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'googletagservices.com', 'app-measurement.com', 'crashlyticsreports-pa.googleapis.com'] },
  { company: 'Meta', ad: ['an.facebook.com'], watch: ['connect.facebook.net', 'pixel.facebook.com', 'graph.facebook.com'] },
  { company: 'Amazon', ad: ['amazon-adsystem.com', 'assoc-amazon.com', 'adsystem.amazon.com'], watch: ['amazonpay-analytics.com', 'fls-na.amazon.com', 'fls-eu.amazon.com'] },
  { company: 'Microsoft', ad: ['bat.bing.com', 'adnxs.com', 'adnxs-simple.com', 'ads.msn.com', 'adsdk.microsoft.com'], watch: ['clarity.ms', 'c.bing.com', 'browser.events.data.msn.com', 'browser.pipe.aria.microsoft.com'] },
  { company: 'X', ad: ['ads-twitter.com', 'ads.x.com'], watch: ['analytics.twitter.com', 'static.ads-twitter.com', 't.co'] },
  { company: 'TikTok', ad: ['ads.tiktok.com'], watch: ['analytics.tiktok.com', 'analytics-ipv6.tiktokw.us'] },
  { company: 'Pinterest', ad: ['ads.pinterest.com'], watch: ['ct.pinterest.com', 's.pinimg.com'] },
  { company: 'Snap', ad: [], watch: ['sc-static.net', 'tr.snapchat.com'] },
  { company: 'LinkedIn', ad: ['ads.linkedin.com'], watch: ['snap.licdn.com', 'px.ads.linkedin.com'] },
  { company: 'Reddit', ad: ['redditads.com'], watch: ['events.reddit.com', 'alb.reddit.com', 'pixel-config.reddit.com'] },
  { company: 'Yahoo', ad: ['ads.yahoo.com', 'advertising.com', 'adtech.de', 'btrll.com', 'gemini.yahoo.com'], watch: ['analytics.yahoo.com', 'geo.yahoo.com', 'udc.yahoo.com'] },
  { company: 'Yandex', ad: ['an.yandex.ru', 'yandexadexchange.net', 'adfox.ru'], watch: ['mc.yandex.ru', 'metrika.yandex.ru', 'mc.webvisor.org'] },
  { company: 'Criteo', ad: ['criteo.com', 'criteo.net'], watch: [] },
  { company: 'Taboola', ad: ['taboola.com', 'taboolasyndication.com'], watch: [] },
  { company: 'Outbrain', ad: ['outbrain.com', 'outbrainimg.com', 'zemanta.com'], watch: [] },
  { company: 'Magnite', ad: ['rubiconproject.com', 'telaria.com', 'tremorhub.com', 'spotxchange.com', 'spotx.tv'], watch: [] },
  { company: 'PubMatic', ad: ['pubmatic.com'], watch: [] },
  { company: 'Index Exchange', ad: ['casalemedia.com', 'indexww.com'], watch: [] },
  { company: 'OpenX', ad: ['openx.net', 'openx.com'], watch: [] },
  { company: 'The Trade Desk', ad: ['adsrvr.org'], watch: ['js.adsrvr.org', 'insight.adsrvr.org'] },
  { company: 'Sovrn', ad: ['lijit.com', 'sovrn.com', 'viglink.com'], watch: [] },
  { company: 'Sharethrough', ad: ['sharethrough.com', 'smartadserver.com'], watch: [] },
  { company: 'TripleLift', ad: ['3lift.com', 'triplelift.com'], watch: [] },
  { company: 'Media.net', ad: ['media.net'], watch: [] },
  { company: 'GumGum', ad: ['gumgum.com'], watch: [] },
  { company: '33Across', ad: ['33across.com', 'tynt.com'], watch: [] },
  { company: 'Teads', ad: ['teads.tv', 'teads.com'], watch: [] },
  { company: 'Adform', ad: ['adform.net', 'adformdsp.net'], watch: [] },
  { company: 'AdRoll', ad: ['adroll.com'], watch: ['d.adroll.com'] },
  { company: 'Quantcast', ad: [], watch: ['quantserve.com', 'quantcount.com', 'quantcast.mgr.consensu.org'] },
  { company: 'Comscore', ad: [], watch: ['scorecardresearch.com', 'zqtk.net', 'voicefive.com'] },
  { company: 'Nielsen', ad: [], watch: ['imrworldwide.com', 'exelator.com'] },
  { company: 'Chartbeat', ad: [], watch: ['chartbeat.com', 'chartbeat.net'] },
  { company: 'Parse.ly', ad: [], watch: ['parsely.com', 'parse.ly'] },
  { company: 'Adobe', ad: ['everesttech.net', 'tubemogul.com'], watch: ['omtrdc.net', 'demdex.net', '2o7.net', 'adobedc.net', 'adobedtm.com'] },
  { company: 'Oracle', ad: ['addthis.com', 'moatads.com', 'moatpixel.com'], watch: ['bluekai.com', 'bkrtx.com', 'eloqua.com'] },
  { company: 'Salesforce', ad: [], watch: ['krxd.net', 'exacttarget.com', 'pardot.com', 'cquotient.com'] },
  { company: 'LiveRamp', ad: [], watch: ['rlcdn.com', 'pippio.com', 'liadm.com', 'ats.rlcdn.com'] },
  { company: 'Lotame', ad: [], watch: ['crwdcntrl.net'] },
  { company: 'Neustar', ad: [], watch: ['agkn.com'] },
  { company: 'Integral Ad Science', ad: ['adsafeprotected.com', 'iasds01.com'], watch: [] },
  { company: 'DoubleVerify', ad: ['doubleverify.com', 'dvtps.com'], watch: [] },
  { company: 'Hotjar', ad: [], watch: ['hotjar.com', 'hotjar.io'] },
  { company: 'FullStory', ad: [], watch: ['fullstory.com'] },
  { company: 'Mouseflow', ad: [], watch: ['mouseflow.com'] },
  { company: 'Crazy Egg', ad: [], watch: ['crazyegg.com'] },
  { company: 'Lucky Orange', ad: [], watch: ['luckyorange.com', 'luckyorange.net'] },
  { company: 'LogRocket', ad: [], watch: ['logrocket.com', 'logrocket.io', 'lr-ingest.io', 'lr-in-prod.com'] },
  { company: 'Mixpanel', ad: [], watch: ['mixpanel.com', 'mxpnl.com'] },
  { company: 'Amplitude', ad: [], watch: ['amplitude.com'] },
  { company: 'Segment', ad: [], watch: ['segment.com', 'segment.io'] },
  { company: 'Heap', ad: [], watch: ['heapanalytics.com', 'heap-api.com'] },
  { company: 'PostHog', ad: [], watch: ['posthog.com'] },
  { company: 'Matomo', ad: [], watch: ['matomo.cloud', 'innocraft.cloud'] },
  { company: 'Plausible', ad: [], watch: ['plausible.io'] },
  { company: 'Cloudflare', ad: [], watch: ['cloudflareinsights.com'] },
  { company: 'New Relic', ad: [], watch: ['nr-data.net', 'js-agent.newrelic.com'] },
  { company: 'Datadog', ad: [], watch: ['datadoghq-browser-agent.com', 'browser-intake-datadoghq.com', 'browser-intake-datadoghq.eu'] },
  { company: 'Sentry', ad: [], watch: ['sentry.io', 'sentry-cdn.com'] },
  { company: 'Bugsnag', ad: [], watch: ['bugsnag.com'] },
  { company: 'SpeedCurve', ad: [], watch: ['speedcurve.com'] },
  { company: 'Akamai', ad: [], watch: ['go-mpulse.net', 'akstat.io'] },
  { company: 'Optimizely', ad: [], watch: ['optimizely.com'] },
  { company: 'VWO', ad: [], watch: ['visualwebsiteoptimizer.com'] },
  { company: 'HubSpot', ad: [], watch: ['hs-analytics.net', 'hs-scripts.com', 'hsadspixel.net', 'hs-banner.com', 'usemessages.com'] },
  { company: 'Marketo', ad: [], watch: ['marketo.net', 'mktoresp.com'] },
  { company: 'Braze', ad: [], watch: ['braze.com', 'appboycdn.com'] },
  { company: 'Klaviyo', ad: [], watch: ['klaviyo.com'] },
  { company: 'Permutive', ad: [], watch: ['permutive.com', 'permutive.app'] },
  { company: 'Piano', ad: [], watch: ['tinypass.com', 'cxense.com', 'piano.io', 'xiti.com'] },
  { company: 'Branch', ad: [], watch: ['branch.io', 'app.link'] },
  { company: 'AppsFlyer', ad: [], watch: ['appsflyer.com', 'onelink.me'] },
  { company: 'Adjust', ad: [], watch: ['adjust.com'] },
  { company: 'Kochava', ad: [], watch: ['kochava.com'] },
  { company: 'ID5', ad: [], watch: ['id5-sync.com'] },
  { company: 'StatCounter', ad: [], watch: ['statcounter.com'] },
  { company: 'Histats', ad: [], watch: ['histats.com'] },
  { company: 'Baidu', ad: ['cpro.baidu.com', 'pos.baidu.com'], watch: ['hm.baidu.com'] },
  { company: 'Automattic', ad: ['wordads.co'], watch: ['stats.wp.com', 'pixel.wp.com'] },
  { company: 'ShareThis', ad: [], watch: ['sharethis.com'] },
  { company: 'OneTrust', ad: [], watch: ['cookielaw.org', 'onetrust.com'] },
  { company: 'Sourcepoint', ad: [], watch: ['sp-prod.net', 'privacy-mgmt.com'] },
  { company: 'Admiral', ad: ['getadmiral.com'], watch: [] },
  { company: 'Ezoic', ad: ['ezoic.net', 'ezojs.com'], watch: [] },
  { company: 'Mediavine', ad: ['mediavine.com'], watch: [] },
  { company: 'Raptive', ad: ['adthrive.com', 'raptive.com'], watch: [] },
  { company: 'Carbon', ad: ['carbonads.com', 'carbonads.net', 'buysellads.com', 'servedby-buysellads.com'], watch: [] },
  { company: 'PopAds', ad: ['popads.net', 'popcash.net', 'propellerads.com', 'adsterra.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.net'], watch: [] },
  { company: 'RevContent', ad: ['revcontent.com'], watch: [] },
  { company: 'MGID', ad: ['mgid.com'], watch: [] },
  { company: 'Confiant', ad: ['confiant-integrations.net'], watch: [] },
];

const BY_NAME = new Map<string, { company: string; ad: boolean }>();
for (const { company, ad, watch } of COMPANIES) {
  for (const name of watch) BY_NAME.set(name, { company, ad: false });
  for (const name of ad) BY_NAME.set(name, { company, ad: true });
}

/** Who a host belongs to when it is a known ad server or tracker; null for everyone else. */
export function watcherAt(hostname: string): { company: string; ad: boolean } | null {
  let name = hostname.toLowerCase().replace(/\.$/, '');
  for (;;) {
    const known = BY_NAME.get(name);
    if (known !== undefined) return known;
    const dot = name.indexOf('.');
    if (dot === -1) return null;
    name = name.slice(dot + 1);
  }
}

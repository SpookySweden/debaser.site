/**
 * A page that is a site's check that a person is asking (Cloudflare's "Just a moment...", a CAPTCHA, DataDome, PerimeterX, Imperva): the
 * machine never answers one (D1 and the search brief), so it says so over the page instead of drawing a puzzle that can't be done.
 * Read from what was drawn: its title alone, or a challenge service's mark with an answer that turns visitors away.
 */
const TITLES = /^\s*(?:just a moment|attention required|access denied|access to this page has been denied|verify(?:ing)? you are (?:a )?human|are you a (?:robot|human)|security check|one more step|pardon our interruption|please verify you are a human|checking your browser|ddos-guard|human verification|bot verification)\s*(?:\.{3}|…|!)?\s*(?:[|:–—-]\s*[^|]{0,60})?$/i;
const MARKS = /challenges\.cloudflare\.com|_cf_chl_opt|cf-chl-|cf-turnstile|hcaptcha\.com|google\.com\/recaptcha|recaptcha\/api|captcha-delivery\.com|px-captcha|_Incapsula_Resource|Incapsula incident|ddos-guard\.net/;

export function isBotCheck(page: { title: string; html: string; status: number | null }): boolean {
  if (TITLES.test(page.title)) return true;
  return page.status !== null && (page.status === 403 || page.status === 429 || page.status === 503) && MARKS.test(page.html.slice(0, 200_000));
}

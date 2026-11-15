/**
 * The longest an address and a title in a queue may be. The database holds these limits too
 * (supabase/migrations/20261030181430_watch_queue_links.sql). In a file of their own so the picture rules
 * (pictures.ts) and the link rules (links.ts) can both read them without one importing the other.
 */
export const LINK_URL_MAX = 2048;
export const LINK_TITLE_MAX = 200;

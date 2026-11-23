/** How long something took, as the status line and a refusal's trace say it: 412 MS under a second, 15.2 S over. Pure. */
export function took(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} MS` : `${(ms / 1000).toFixed(1)} S`;
}

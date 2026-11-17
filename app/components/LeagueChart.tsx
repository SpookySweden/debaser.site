/**
 * LEAGUEBOT's line charts (SPEC-leaguebot.md: data charts drawn by code in token colours, not illustrations): LP over time
 * on STATS, gold/CS/XP against the lane opponent on REVIEW. One or two lines, an optional zero line, the highest and
 * lowest values written beside the plot, and a table of the same numbers for screen readers.
 *
 * Drawn in a fixed box the browser stretches; the words sit outside the drawing in the page's own type, so they never
 * stretch with it.
 */

export type ChartPoint = { x: number; y: number };
export type ChartSeries = {
  label: string;
  points: ChartPoint[];
  tone: 'ink' | 'accent';
};

const W = 600;
const H = 160;
const PAD = 6;

export default function LeagueChart({
  series,
  label,
  yText,
  xText,
  zero = false,
}: {
  series: ChartSeries[];
  /** What the chart shows, for screen readers. */
  label: string;
  yText: (y: number) => string;
  xText: (x: number) => string;
  zero?: boolean;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return null;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y).concat(zero ? [0] : []);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => PAD + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD * 2);
  const sy = (y: number) => H - PAD - ((y - y0) / Math.max(1, y1 - y0)) * (H - PAD * 2);
  return (
    <figure className="px-2 py-1">
      <div className="flex gap-2">
        <div className="flex w-24 shrink-0 flex-col justify-between text-right text-label text-ink" aria-hidden="true">
          <span>{yText(y1)}</span>
          <span>{yText((y0 + y1) / 2)}</span>
          <span>{yText(y0)}</span>
        </div>
        {/* The drawing is for the eye; screen readers get the table of the same numbers below. */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-40 min-w-0 flex-1 border-b-thick border-l-thick border-ink"
          aria-hidden="true"
          focusable="false"
        >
          {zero && y0 < 0 && y1 > 0 ? (
            <line
              x1={0}
              x2={W}
              y1={sy(0)}
              y2={sy(0)}
              className="text-ink"
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {series.map((s) => (
            <g key={s.label} className={s.tone === 'accent' ? 'text-accent-ink' : 'text-ink'}>
              <polyline
                points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth={s.tone === 'accent' ? 2 : 3}
                strokeDasharray={s.tone === 'accent' ? '6 3' : undefined}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </g>
          ))}
        </svg>
      </div>
      <div className="ml-26 flex justify-between text-label text-ink" aria-hidden="true">
        <span>{xText(x0)}</span>
        {series.length > 1 ? (
          <span className="flex gap-3">
            {series.map((s) => (
              <span key={s.label}>
                {s.tone === 'accent' ? '- - ' : '━━ '}
                {s.label}
              </span>
            ))}
          </span>
        ) : null}
        <span>{xText(x1)}</span>
      </div>
      {/* A table ignores the 1px box `sr-only` gives it and would widen the page: the box goes round it instead. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {series.flatMap((s) =>
              s.points.map((p, i) => (
                <tr key={`${s.label}-${i}`}>
                  <th scope="row">
                    {s.label} {xText(p.x)}
                  </th>
                  <td>{yText(p.y)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

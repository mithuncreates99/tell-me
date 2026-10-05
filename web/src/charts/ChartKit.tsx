import { Table2, BarChart3 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../components/ui';

/**
 * Small, dependency-free SVG charts following one set of rules:
 * thin marks (≤24px bars, 4px rounded data end, square baseline), hairline solid grid,
 * text in ink colors (never the series color), hover/focus tooltips that never gate a value,
 * and a table view for every chart.
 */

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function ChartCard({
  title,
  subtitle,
  table,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  table: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className={cx('card m-0 flex flex-col p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <figcaption>
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
        </figcaption>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold text-ink-3 hover:bg-surface-2"
          aria-pressed={showTable}
        >
          {showTable ? <BarChart3 size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {showTable ? <div className="overflow-x-auto">{table}</div> : children}
    </figure>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <table className="tabular w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-line text-ink-3">
          {head.map((h, i) => (
            <th key={h} className={cx('py-1.5 font-semibold', i > 0 && 'text-right')} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line last:border-0">
            {r.map((c, j) => (
              <td key={j} className={cx('py-1.5', j > 0 ? 'text-right text-ink-2' : 'font-medium')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface TipState {
  x: number;
  y: number;
  value: string;
  label: string;
}

function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-2 shadow-lg"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <div className="text-[15px] font-bold leading-tight">{tip.value}</div>
      <div className="text-[12px] text-ink-3">{tip.label}</div>
    </div>
  );
}

/** Path for a bar with rounded top corners and a square baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export interface ColumnDatum {
  key: string;
  label: string;
  /** 0..1, or null when there was nothing to measure */
  value: number | null;
  /** Tooltip / table detail, e.g. "9 of 12 check-ins" */
  detail: string;
  emphasis?: boolean;
  /** Show the value above the bar */
  showLabel?: boolean;
}

export function ColumnChart({ data, height = 168, ariaLabel }: { data: ColumnDatum[]; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const left = 34;
  const top = 20;
  const bottom = 24;
  const plotH = height - top - bottom;
  const plotW = Math.max(0, width - left - 4);
  const slot = data.length ? plotW / data.length : 0;
  const barW = Math.min(24, slot * 0.56);
  const y = (v: number) => top + plotH * (1 - v);
  const anyEmphasis = data.some((d) => d.emphasis);
  // When columns are narrow, label every other one, always including the emphasized column.
  const emphasized = data.findIndex((d) => d.emphasis);
  const anchor = emphasized >= 0 ? emphasized : data.length - 1;
  const showAxisLabel = (i: number) => slot >= 40 || Math.abs(anchor - i) % 2 === 0;

  useEffect(() => setTip(null), [data]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {[0, 0.5, 1].map((g) => (
            <g key={g}>
              <line x1={left} x2={width - 4} y1={y(g)} y2={y(g)} stroke={g === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
              <text x={left - 8} y={y(g)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--ink-3)] text-[11px]">
                {Math.round(g * 100)}%
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx0 = left + slot * i + slot / 2;
            const h = d.value === null ? 0 : Math.max(d.value > 0 ? 3 : 0, plotH * d.value);
            const fill = !anyEmphasis || d.emphasis ? 'var(--brand)' : 'var(--heat-1)';
            const showTip = () =>
              setTip({
                x: cx0,
                y: d.value === null ? y(0) : y(d.value),
                value: d.value === null ? 'No check-ins' : `${Math.round(d.value * 100)}%`,
                label: `${d.label} · ${d.detail}`,
              });
            return (
              <g key={d.key}>
                {h > 0 && <path d={barPath(cx0 - barW / 2, y(0) - h, barW, h)} fill={fill} />}
                {d.value === null && (
                  <text x={cx0} y={y(0) - 6} textAnchor="middle" className="fill-[var(--ink-3)] text-[11px]">
                    –
                  </text>
                )}
                {d.showLabel && d.value !== null && (
                  <text x={cx0} y={y(d.value) - 6} textAnchor="middle" className="tabular fill-[var(--ink)] text-[11px] font-semibold">
                    {Math.round(d.value * 100)}%
                  </text>
                )}
                {showAxisLabel(i) && (
                  <text
                    x={cx0}
                    y={height - 6}
                    textAnchor="middle"
                    className={cx('text-[11px]', d.emphasis ? 'fill-[var(--ink)] font-semibold' : 'fill-[var(--ink-3)]')}
                  >
                    {d.label}
                  </text>
                )}
                {/* hit target: the whole column, bigger than the mark */}
                <rect
                  x={left + slot * i}
                  y={top - 10}
                  width={slot}
                  height={plotH + 10}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`${d.label}: ${d.value === null ? 'no check-ins' : `${Math.round(d.value * 100)}%`}, ${d.detail}`}
                  onPointerEnter={showTip}
                  onPointerMove={showTip}
                  onFocus={showTip}
                  onBlur={() => setTip(null)}
                  className="cursor-default outline-none focus-visible:stroke-[var(--brand)]"
                />
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: ReactNode;
  value: number;
  display: string;
}

/** Horizontal bars for a few nominal categories, sorted, with values at the bar tips. */
export function BarList({ data, max }: { data: BarDatum[]; max?: number }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="grid grid-cols-1 gap-2.5">
      {data.map((d) => (
        <li key={d.key} className="grid grid-cols-[minmax(92px,auto)_1fr] items-center gap-3 text-[13px]">
          <span className="truncate font-medium text-ink-2">{d.label}</span>
          <span className="flex items-center gap-2">
            <span
              className="h-3 rounded-r-[4px] bg-brand"
              style={{ width: `calc(${(d.value / top) * 100}% - 32px)`, minWidth: d.value > 0 ? 4 : 0 }}
              aria-hidden
            />
            <span className="tabular shrink-0 font-semibold text-ink">{d.display}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface HeatDatum {
  date: string;
  due: number;
  yes: number;
  future: boolean;
}

export function heatColor(c: Pick<HeatDatum, 'due' | 'yes' | 'future'>): string {
  if (c.future) return 'transparent';
  if (c.due === 0) return 'var(--heat-empty)';
  const r = c.yes / c.due;
  if (r === 0) return 'var(--heat-0)';
  if (r < 0.5) return 'var(--heat-1)';
  if (r < 1) return 'var(--heat-2)';
  return 'var(--heat-3)';
}

export function HeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
      <span className="flex items-center gap-1">
        None
        {['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)'].map((c) => (
          <span key={c} className="inline-block h-3 w-3 rounded-[3px]" style={{ background: c }} />
        ))}
        All done
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: 'var(--heat-empty)' }} /> Nothing planned
      </span>
    </div>
  );
}

export function Heatmap({
  columns,
  rowLabels,
  monthLabel,
  dayLabel,
}: {
  columns: HeatDatum[][];
  rowLabels: string[];
  monthLabel: (date: string) => string;
  dayLabel: (date: string) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const labelW = 30;
  const gap = 3;
  const n = columns.length;
  const cell = n ? Math.max(8, Math.min(18, Math.floor((width - labelW - gap * (n - 1)) / n))) : 12;
  const top = 16;
  const height = top + 7 * cell + 6 * gap;

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Daily consistency heatmap" className="block overflow-visible">
          {rowLabels.map((l, r) =>
            r % 2 === 0 ? (
              <text key={l} x={0} y={top + r * (cell + gap) + cell / 2} dy="0.32em" className="fill-[var(--ink-3)] text-[10px]">
                {l}
              </text>
            ) : null,
          )}
          {columns.map((col, c) => {
            const x = labelW + c * (cell + gap);
            const first = col[0]!;
            const prev = columns[c - 1]?.[0];
            const showMonth = !prev || prev.date.slice(0, 7) !== first.date.slice(0, 7);
            return (
              <g key={first.date}>
                {showMonth && (
                  <text x={x} y={10} className="fill-[var(--ink-3)] text-[10px]">
                    {monthLabel(first.date)}
                  </text>
                )}
                {col.map((d, r) => {
                  const y = top + r * (cell + gap);
                  const show = () =>
                    setTip({
                      x: x + cell / 2,
                      y,
                      value: d.future ? 'Upcoming' : d.due ? `${d.yes} of ${d.due}` : 'Nothing planned',
                      label: dayLabel(d.date),
                    });
                  return (
                    <rect
                      key={d.date}
                      x={x}
                      y={y}
                      width={cell}
                      height={cell}
                      rx={3}
                      fill={heatColor(d)}
                      stroke={d.future ? 'var(--grid)' : 'none'}
                      strokeWidth={1}
                      tabIndex={d.future ? -1 : 0}
                      aria-label={`${dayLabel(d.date)}: ${d.due ? `${d.yes} of ${d.due} done` : 'nothing planned'}`}
                      onPointerEnter={show}
                      onFocus={show}
                      onBlur={() => setTip(null)}
                      className="outline-none focus-visible:stroke-[var(--brand)]"
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

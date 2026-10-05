import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, Flame, Share2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BarList, ChartCard, ColumnChart, DataTable, Heatmap, HeatLegend } from '../charts/ChartKit';
import { DemoBanner } from '../components/DemoBanner';
import { EmptyState, HabitBadge, IconButton, PageHeader, SectionTitle, cx } from '../components/ui';
import { addDays, formatDate, orderedWeekdays, startOfWeek, todayISO, weekdayName, weekLabel } from '../lib/dates';
import { buildInsights, type Insight } from '../lib/insights';
import { REASON_EMOJI, REASON_LABEL } from '../lib/labels';
import { IS_NATIVE, shareText } from '../lib/native';
import { isScheduledOn, occurrence } from '../lib/schedule';
import {
  compareWithLastWeek,
  heatmapWeeks,
  pct,
  rateOf,
  reasonCounts,
  streakFor,
  weekdayTallies,
  weeklySeries,
  weekStats,
} from '../lib/stats';
import { navigate } from '../router';
import { useStore } from '../store/useStore';

export function Insights() {
  const habits = useStore((s) => s.habits);
  const checkins = useStore((s) => s.checkins);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const showToast = useStore((s) => s.showToast);
  const today = todayISO(now);
  const thisWeek = startOfWeek(today, settings.weekStartsOn);
  const [weekStart, setWeekStart] = useState(thisWeek);
  const earliest = habits.reduce((min, h) => (h.createdAt < min ? h.createdAt : min), today);
  const firstWeek = startOfWeek(earliest, settings.weekStartsOn);

  const data = useMemo(() => {
    const cmp = compareWithLastWeek(habits, checkins, weekStart, settings, now);
    return {
      cmp,
      week: weekStats(habits, checkins, weekStart, settings, now),
      insights: buildInsights({ habits, checkins, settings, now, weekStart }),
      series: weeklySeries(habits, checkins, weekStart, settings, now, 8),
      weekdays: weekdayTallies(habits, checkins, settings, now, 56),
      reasons: reasonCounts(habits, checkins, addDays(today, -55), today),
      heat: heatmapWeeks(habits, checkins, settings, now, 16),
    };
  }, [habits, checkins, settings, now, weekStart, today]);

  if (habits.length === 0) {
    return (
      <div>
        <PageHeader title="Weekly report" />
        <EmptyState icon="📊" title="No habits yet">
          Add a habit and answer a few check-ins. Your report and insights will show up here.
        </EmptyState>
      </div>
    );
  }

  const { cmp } = data;
  const rate = rateOf(cmp.current);
  const prevRate = rateOf(cmp.previous);
  // Only compare when both periods have enough check-ins to mean something.
  const delta = rate !== null && prevRate !== null && cmp.current.due >= 3 && cmp.previous.due >= 3 ? Math.round((rate - prevRate) * 100) : null;
  const isThisWeek = weekStart === thisWeek;
  const weekdays = orderedWeekdays(settings.weekStartsOn);

  const share = async () => {
    const lines = [
      `My Tell Me week (${weekLabel(weekStart)}): ${pct(rate)}, ${cmp.current.yes} of ${cmp.current.due} check-ins ✅`,
      habits
        .filter((h) => data.week.byHabit.get(h.id))
        .map((h) => {
          const t = data.week.byHabit.get(h.id)!;
          return `${h.emoji} ${h.name} ${t.yes}/${t.due}`;
        })
        .join(' · '),
    ];
    const text = lines.join('\n');
    if (IS_NATIVE) {
      await shareText('My week on Tell Me', text).catch(() => {});
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'My week on Tell Me', text });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // the user closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Weekly summary copied. Paste it anywhere.');
    } catch {
      showToast("Couldn't share or copy from this browser.", { tone: 'bad' });
    }
  };

  const seriesData = data.series.map((w) => {
    const r = rateOf(w.total);
    return {
      key: w.weekStart,
      label: formatDate(w.weekStart, { day: 'numeric', month: 'short' }),
      value: r,
      detail: `${w.total.yes} of ${w.total.due} check-ins`,
      emphasis: w.weekStart === weekStart,
    };
  });
  const best = Math.max(...seriesData.map((d) => d.value ?? -1));
  seriesData.forEach((d) => {
    (d as { showLabel?: boolean }).showLabel = d.emphasis || (d.value === best && best >= 0);
  });

  const weekdayData = weekdays.map((wd) => {
    const t = data.weekdays.get(wd)!;
    return { key: String(wd), label: weekdayName(wd, 'short'), value: rateOf(t), detail: `${t.yes} of ${t.due}`, t };
  });
  const known = weekdayData.filter((d) => d.value !== null && d.t.due >= 2);
  const hi = known.length ? Math.max(...known.map((d) => d.value!)) : null;
  const lo = known.length ? Math.min(...known.map((d) => d.value!)) : null;
  const weekdayChart = weekdayData.map((d) => ({ ...d, showLabel: d.value !== null && (d.value === hi || d.value === lo) }));

  const reasons = [...data.reasons.counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <PageHeader eyebrow="Weekly report" title={isThisWeek ? 'This week' : weekLabel(weekStart)} />
      <DemoBanner />

      <div className="mb-3 flex items-center justify-between">
        <IconButton label="Previous week" disabled={weekStart <= firstWeek} onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft size={20} />
        </IconButton>
        <span className="text-[14px] font-semibold text-ink-2">{weekLabel(weekStart)}</span>
        <IconButton label="Next week" disabled={isThisWeek} onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight size={20} />
        </IconButton>
      </div>

      <section className="card p-5" aria-label="Week summary">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Showed up</p>
            <p className="mt-1 text-[56px] font-bold leading-none tracking-tight">{pct(rate)}</p>
            <p className="mt-2 text-[15px] text-ink-2">
              {cmp.current.yes} of {cmp.current.due} check-ins answered Yes
            </p>
            {cmp.current.unanswered > 0 && (
              <p className="text-[13px] text-ink-3">
                {cmp.current.unanswered} unanswered{isThisWeek ? ', answer on Today' : ''}
              </p>
            )}
          </div>
          <IconButton label="Share this week" onClick={() => void share()}>
            <Share2 size={19} />
          </IconButton>
        </div>
        {delta !== null && (
          <p
            className={cx(
              'mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold',
              delta > 0 ? 'bg-yes-soft text-yes' : delta < 0 ? 'bg-no-soft text-no' : 'bg-surface-2 text-ink-2',
            )}
          >
            {delta > 0 ? <ArrowUp size={14} aria-hidden /> : delta < 0 ? <ArrowDown size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
            {delta > 0 ? '+' : delta < 0 ? '−' : ''}
            {Math.abs(delta)} pts vs {cmp.partial ? 'this time last week' : 'last week'}
          </p>
        )}
      </section>

      <SectionTitle>Insights</SectionTitle>
      <div className="grid grid-cols-1 gap-2.5">
        {data.insights.map((i) => (
          <InsightCard key={i.id} insight={i} />
        ))}
      </div>

      <SectionTitle>Habits this week</SectionTitle>
      <section className="card divide-y divide-[var(--line)] px-4 py-1" aria-label="Habits this week">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2">
          <span />
          <div className="grid grid-cols-7 gap-[3px]">
            {weekdays.map((wd) => (
              <span key={wd} className="w-[22px] text-center text-[11px] font-semibold text-ink-3">
                {weekdayName(wd, 'narrow')}
              </span>
            ))}
          </div>
        </div>
        {habits
          .filter((h) => [0, 1, 2, 3, 4, 5, 6].some((i) => isScheduledOn(h, addDays(weekStart, i))))
          .map((h) => {
            const t = data.week.byHabit.get(h.id);
            const streak = isThisWeek ? streakFor(h, checkins, settings, now).current : 0;
            return (
              <div key={h.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <HabitBadge emoji={h.emoji} color={h.color} size={30} />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">{h.name}</p>
                    <p className="tabular text-[12px] text-ink-3">
                      {t ? `${t.yes}/${t.due} · ${pct(rateOf(t))}` : 'Nothing due yet'}
                      {streak >= 2 && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-flame">
                          <Flame size={11} aria-hidden />
                          {streak}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-[3px]">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                    const date = addDays(weekStart, i);
                    if (!isScheduledOn(h, date)) return <span key={date} className="h-[22px] w-[22px]" aria-hidden />;
                    const o = occurrence(h, date, checkins, settings, now);
                    const label = `${formatDate(date)}: ${o.state === 'yes' ? 'yes' : o.state === 'no' ? 'no' : o.state === 'pending' ? 'unanswered' : 'upcoming'}`;
                    return (
                      <span
                        key={date}
                        title={label}
                        aria-label={label}
                        role="img"
                        className={cx(
                          'flex h-[22px] w-[22px] items-center justify-center rounded-full text-[12px] font-bold',
                          o.state === 'yes' && 'bg-yes-soft text-yes',
                          o.state === 'no' && 'bg-no-soft text-no',
                          o.state === 'pending' && 'bg-surface-2 text-ink-3',
                          o.state === 'upcoming' && 'border border-[var(--axis)]',
                        )}
                      >
                        {o.state === 'yes' ? <Check size={13} strokeWidth={3.5} /> : o.state === 'no' ? <X size={13} strokeWidth={3.5} /> : o.state === 'pending' ? '?' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </section>

      <SectionTitle>Trends</SectionTitle>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Last 8 weeks"
          subtitle="Share of check-ins answered Yes"
          table={<DataTable head={['Week', 'Yes', 'Due', 'Rate']} rows={data.series.map((w) => [weekLabel(w.weekStart), w.total.yes, w.total.due, pct(rateOf(w.total))])} />}
        >
          <ColumnChart data={seriesData} ariaLabel="Completion rate for the last 8 weeks" />
        </ChartCard>

        <ChartCard
          title="By weekday"
          subtitle="Last 8 weeks. Which days slip?"
          table={<DataTable head={['Day', 'Yes', 'Due', 'Rate']} rows={weekdayData.map((d) => [weekdayName(Number(d.key) as never, 'long'), d.t.yes, d.t.due, pct(d.value)])} />}
        >
          <ColumnChart data={weekdayChart} ariaLabel="Completion rate by weekday" />
        </ChartCard>

        <ChartCard
          title="Why you missed"
          subtitle={
            data.reasons.misses
              ? `${data.reasons.misses} misses in the last 8 weeks${data.reasons.withoutReason ? `, ${data.reasons.withoutReason} without a reason` : ''}`
              : 'Last 8 weeks'
          }
          table={<DataTable head={['Reason', 'Misses']} rows={reasons.map(([r, n]) => [REASON_LABEL[r], n])} />}
        >
          {reasons.length ? (
            <BarList
              data={reasons.map(([r, n]) => ({ key: r, label: `${REASON_EMOJI[r]} ${REASON_LABEL[r]}`, value: n, display: String(n) }))}
            />
          ) : (
            <p className="py-6 text-center text-[14px] text-ink-3">
              {data.reasons.misses ? 'Add a reason when you answer No to see patterns here.' : 'No misses. Impressive! 🎉'}
            </p>
          )}
        </ChartCard>

        <ChartCard
          title="Consistency"
          subtitle="Last 16 weeks, one square per day"
          table={
            <DataTable
              head={['Week of', 'Yes', 'Due']}
              rows={data.heat.map((col) => [
                weekLabel(col[0]!.date),
                col.reduce((n, d) => n + d.yes, 0),
                col.reduce((n, d) => n + d.due, 0),
              ])}
            />
          }
        >
          <Heatmap
            columns={data.heat}
            rowLabels={weekdays.map((wd) => weekdayName(wd, 'short'))}
            monthLabel={(d) => formatDate(d, { month: 'short' })}
            dayLabel={(d) => formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}
          />
          <div className="mt-3">
            <HeatLegend />
          </div>
        </ChartCard>
      </div>

      <p className="mt-6 px-1 text-center text-[12px] text-ink-3">Insights are computed on this device. Your answers never leave it.</p>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const toneLabel = insight.tone === 'good' ? 'Win' : insight.tone === 'bad' ? 'Watch out' : 'Tip';
  return (
    <article className="card animate-rise flex gap-3 p-4">
      <span
        aria-hidden
        className={cx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xl',
          insight.tone === 'good' ? 'bg-yes-soft' : insight.tone === 'bad' ? 'bg-no-soft' : 'bg-brand-soft',
        )}
      >
        {insight.icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{toneLabel}</p>
        <h3 className="text-[15px] font-semibold leading-snug">{insight.title}</h3>
        <p className="mt-0.5 text-[14px] leading-snug text-ink-2">{insight.detail}</p>
        {insight.action === 'answer-pending' && (
          <button type="button" className="mt-1.5 text-[13px] font-semibold text-brand" onClick={() => navigate('/')}>
            Answer them now →
          </button>
        )}
      </div>
    </article>
  );
}

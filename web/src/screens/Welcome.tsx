import { BarChart3, BellRing, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { QuickAdd } from '../components/QuickAdd';
import { Button, Chip, Logo } from '../components/ui';
import { navigate } from '../router';
import { useStore } from '../store/useStore';

const SUGGESTIONS = [
  '🏋️ Gym Mon Wed Fri 18:00',
  '📚 Read 20 pages daily 22:00',
  '🧘 Meditate weekdays 7:30',
  '🇫🇷 French Tue Thu 19h',
  '🏃 Run Sat 9am',
  '💧 Drink 2L water daily',
];

export function Welcome() {
  const [text, setText] = useState('');
  const loadDemo = useStore((s) => s.loadDemo);
  const showToast = useStore((s) => s.showToast);

  return (
    <div className="mx-auto max-w-xl pb-10 pt-4 sm:pt-10">
      <div className="animate-rise">
        <Logo size={56} />
        <h1 className="mt-5 text-[34px] font-bold leading-[1.1] tracking-tight sm:text-[42px]">Did you show up today?</h1>
        <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
          Tell Me asks one Yes/No question for each of your habits at the right time, then turns your answers into a weekly
          report with insights.
        </p>
      </div>

      <div className="animate-rise mt-7" style={{ animationDelay: '60ms' }}>
        <p className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Add your first habit</p>
        <QuickAdd value={text} onValueChange={setText} />
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {SUGGESTIONS.map((s) => (
            <Chip key={s} onClick={() => setText(s.replace(/^\S+\s/, ''))}>
              {s}
            </Chip>
          ))}
        </div>
        <p className="mt-2 px-1 text-[13px] text-ink-3">
          <Wand2 size={13} className="mr-1 inline -translate-y-px" aria-hidden />
          Write it the way you'd say it: days, times like 6pm, 18:00 or 19h, "daily", "weekdays", "3x a week".
        </p>
      </div>

      <div className="animate-rise mt-6 flex flex-wrap items-center gap-3" style={{ animationDelay: '120ms' }}>
        <Button
          variant="secondary"
          onClick={async () => {
            await loadDemo();
            showToast('Demo loaded: 8 weeks of sample check-ins. Reset it any time in Settings.');
            navigate('/insights');
          }}
        >
          <Sparkles size={18} aria-hidden /> Explore with demo data
        </Button>
      </div>

      <ul className="animate-rise mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3" style={{ animationDelay: '180ms' }}>
        {[
          { icon: <BellRing size={20} />, title: 'Yes/No reminders', body: 'Answer straight from the notification.' },
          { icon: <BarChart3 size={20} />, title: 'Weekly report', body: 'Streaks, trends and your weak spots.' },
          { icon: <ShieldCheck size={20} />, title: 'Private', body: 'Your answers never leave this device.' },
        ].map((f) => (
          <li key={f.title} className="card p-4">
            <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand">{f.icon}</span>
            <p className="font-semibold">{f.title}</p>
            <p className="mt-0.5 text-[14px] text-ink-3">{f.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

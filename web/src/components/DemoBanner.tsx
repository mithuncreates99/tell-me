import { FlaskConical } from 'lucide-react';
import { useStore } from '../store/useStore';
import { Button } from './ui';

/** Shown while the sample data is loaded, so nobody mistakes it for real check-ins. */
export function DemoBanner() {
  const isDemo = useStore((s) => s.habits.some((h) => h.id.startsWith('demo-')));
  const resetAll = useStore((s) => s.resetAll);
  const showToast = useStore((s) => s.showToast);
  if (!isDemo) return null;
  return (
    <section className="mb-4 flex items-center gap-3 rounded-2xl border border-dashed border-[var(--axis)] px-4 py-3" aria-label="Sample data">
      <FlaskConical size={18} className="shrink-0 text-brand" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
        <span className="font-semibold text-ink">Sample data.</span> These 8 weeks of check-ins are made up so you can explore.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={async () => {
          await resetAll();
          showToast('Cleared. Add your first habit to start.');
        }}
      >
        Start fresh
      </Button>
    </section>
  );
}

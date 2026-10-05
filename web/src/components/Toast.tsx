import { useStore } from '../store/useStore';
import { cx } from './ui';

export function Toast() {
  const toast = useStore((s) => s.toast);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-[60] flex justify-center px-4 md:bottom-6" aria-live="polite">
      {toast && (
        <div
          key={toast.id}
          role="status"
          className={cx(
            'animate-rise pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-[14px] font-medium shadow-xl',
            'bg-[#1d1b26] text-white',
          )}
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="shrink-0 rounded-lg px-2 py-1 font-semibold text-[#b0adfe] hover:bg-white/10"
              onClick={() => {
                toast.action!.run();
                dismiss();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

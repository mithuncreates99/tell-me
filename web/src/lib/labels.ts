import type { MissReason } from './types';

export const REASON_LABEL: Record<MissReason, string> = {
  tired: 'Too tired',
  busy: 'Too busy',
  sick: 'Sick',
  forgot: 'Forgot',
  rest: 'Rest day',
  other: 'Other',
};

export const REASON_EMOJI: Record<MissReason, string> = {
  tired: '😮‍💨',
  busy: '📅',
  sick: '🤒',
  forgot: '🤔',
  rest: '🛌',
  other: '💬',
};

export const REASON_ADVICE: Record<MissReason, string> = {
  tired: 'Try an earlier slot, or plan a lighter version for low-energy days.',
  busy: "Block the time in your calendar like a meeting you can't move.",
  sick: 'Recovery comes first. The streak can wait.',
  forgot: 'Turn on reminders, or attach it to something you already do every day.',
  rest: 'If the rest is planned, take that day off the schedule so it stops counting as a miss.',
  other: 'Add a short note when you miss. Patterns get easier to spot.',
};

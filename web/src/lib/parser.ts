import { suggestEmoji } from './emoji';
import type { Weekday } from './types';

/**
 * Natural-language quick add: "Gym Mon Wed Fri 6pm", "Read 20 pages daily 22:00",
 * "French class Tue/Thu 19h30", "Run weekends 9am", "Meditate weekdays 7:30", "Gym 3x a week".
 * Runs entirely on the device — no AI service, no network.
 */
export interface ParsedHabit {
  name: string;
  emoji: string;
  days: Weekday[];
  time: string | null;
  /** True when no days were given and we defaulted to every day. */
  daysDefaulted: boolean;
}

const ALL: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const WEEKENDS: Weekday[] = [0, 6];

const DAY_WORDS: Record<string, Weekday> = {
  sun: 0, sunday: 0, sundays: 0,
  mon: 1, monday: 1, mondays: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5,
  sat: 6, saturday: 6, saturdays: 6,
};
const DAY_ALT = Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length).join('|');

/** Evenly spread N sessions over a week. */
const SPREAD: Record<number, Weekday[]> = {
  1: [6],
  2: [2, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: WEEKDAYS,
  6: [1, 2, 3, 4, 5, 6],
  7: ALL,
};
const WORD_COUNT: Record<string, number> = { once: 1, twice: 2, thrice: 3 };

const pad = (n: number) => String(n).padStart(2, '0');

function to24h(hour: number, minute: number, meridiem?: string): string | null {
  let h = hour;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    const pm = meridiem.toLowerCase() === 'pm';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || minute > 59) return null;
  return `${pad(h)}:${pad(minute)}`;
}

interface Extracted<T> {
  value: T;
  rest: string;
}

function extractTime(input: string): Extracted<string | null> {
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
    // 18:00, 7:30pm, 7.30, 19h30
    [/(?:\bat\s+|@\s*)?\b(\d{1,2})(?::|\.|h)(\d{2})\s*(am|pm)?\b/i, (m) => to24h(+m[1]!, +m[2]!, m[3])],
    // 6pm, 6 pm
    [/(?:\bat\s+|@\s*)?\b(\d{1,2})\s*(am|pm)\b/i, (m) => to24h(+m[1]!, 0, m[2])],
    // 19h (French style); 1h–4h are treated as durations, not times
    [/(?:\bat\s+|@\s*)?\b(\d{1,2})h\b/i, (m) => (+m[1]! >= 5 ? to24h(+m[1]!, 0) : null)],
    // "at 7" – assume 1–6 means afternoon/evening
    [/(?:\bat|@)\s*(\d{1,2})\b(?!\s*(?:min|mins|minutes|pages|km|x|times))/i, (m) => {
      const h = +m[1]!;
      return to24h(h >= 1 && h <= 6 ? h + 12 : h, 0);
    }],
    [/\b(?:at\s+)?(noon|midday)\b/i, () => '12:00'],
    [/\b(?:in\s+the\s+|every\s+)?mornings?\b/i, () => '08:00'],
    [/\b(?:in\s+the\s+|every\s+)?afternoons?\b/i, () => '14:00'],
    [/\b(?:in\s+the\s+|every\s+)?evenings?\b/i, () => '19:00'],
    [/\b(?:at\s+|every\s+)?(?:night|nights|tonight)\b/i, () => '21:00'],
  ];
  for (const [re, toTime] of patterns) {
    const m = input.match(re);
    if (!m) continue;
    const time = toTime(m);
    if (time) return { value: time, rest: input.replace(m[0], ' ') };
  }
  return { value: null, rest: input };
}

function extractDays(input: string): Extracted<Weekday[] | null> {
  let rest = input;
  const days = new Set<Weekday>();
  const take = (re: RegExp, add: (m: RegExpMatchArray) => Weekday[]) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      for (const d of add(m)) days.add(d);
      return ' ';
    });
  };

  take(/\b(?:every\s*day|everyday|daily|each\s+day|all\s+week)\b/gi, () => ALL);
  take(/\b(?:every\s+|on\s+)?week\s?days\b|\bevery\s+weekday\b/gi, () => WEEKDAYS);
  take(/\b(?:every\s+|on\s+)?weekends?\b/gi, () => WEEKENDS);
  take(/\b(\d|once|twice|thrice)\s*(?:x|times?)?\s*(?:a|per|\/|each)?\s*(?:week|wk)\b/gi, (m) => {
    const raw = m[1]!.toLowerCase();
    const n = WORD_COUNT[raw] ?? Number(raw);
    return SPREAD[Math.min(7, Math.max(1, n))] ?? [];
  });
  const range = new RegExp(`\\b(${DAY_ALT})\\s*(?:-|–|to|through|thru|until)\\s*(${DAY_ALT})\\b`, 'gi');
  take(range, (m) => {
    const from = DAY_WORDS[m[1]!.toLowerCase()]!;
    const to = DAY_WORDS[m[2]!.toLowerCase()]!;
    const out: Weekday[] = [];
    for (let d = from; ; d = ((d + 1) % 7) as Weekday) {
      out.push(d);
      if (d === to || out.length > 7) break;
    }
    return out;
  });
  take(new RegExp(`\\b(${DAY_ALT})\\b\\.?`, 'gi'), (m) => [DAY_WORDS[m[1]!.toLowerCase()]!]);

  return { value: days.size ? ([...days].sort() as Weekday[]) : null, rest };
}

const FILLER = /^(?:every|on|at|and|each|per|from|the|in|@|&|\/|,|-|–|\+|x)$/i;

function cleanName(raw: string): string {
  const words = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  // Strip connective words left behind at either end ("Gym every , and" -> "Gym").
  while (words.length && FILLER.test(words[words.length - 1]!.replace(/[,.;:]+$/, '') || ',')) words.pop();
  while (words.length && FILLER.test(words[0]!.replace(/[,.;:]+$/, '') || ',')) words.shift();
  const name = words.join(' ').replace(/[\s,;:/&+-]+$/, '').replace(/^[\s,;:/&+-]+/, '').trim();
  return name ? name[0]!.toUpperCase() + name.slice(1) : '';
}

export function parseHabit(input: string): ParsedHabit | null {
  const text = input.trim();
  if (!text) return null;
  const time = extractTime(text);
  const days = extractDays(time.rest);
  const name = cleanName(days.rest);
  if (!name) return null;
  return {
    name: name.slice(0, 60),
    emoji: suggestEmoji(name),
    days: days.value ?? ALL,
    time: time.value,
    daysDefaulted: days.value === null,
  };
}

/** One habit per line. CSV rows ("Gym,Mon Wed Fri,18:00") work too; a header row is skipped. */
export function parseSchedule(text: string): ParsedHabit[] {
  return text
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter((line) => line && !/^name\s*,/i.test(line) && !line.startsWith('#'))
    .map((line) => (line.includes(',') && line.split(',').length >= 2 ? line.split(',').join(' ') : line))
    .map(parseHabit)
    .filter((h): h is ParsedHabit => h !== null);
}

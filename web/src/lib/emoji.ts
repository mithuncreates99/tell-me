/** Picks a fitting emoji from the habit name. First match wins. */
const RULES: Array<[RegExp, string]> = [
  [/\b(gym|workout|lift|weights?|strength|crossfit)\b/i, '🏋️'],
  [/\b(run|running|jog|jogging|5k|10k|marathon)\b/i, '🏃'],
  [/\b(walk|walking|steps)\b/i, '🚶'],
  [/\b(swim|swimming|pool)\b/i, '🏊'],
  [/\b(bike|biking|cycle|cycling|spin)\b/i, '🚴'],
  [/\b(yoga|stretch|stretching|mobility|pilates)\b/i, '🧘'],
  [/\b(meditat\w*|mindful\w*|breath\w*)\b/i, '🧘'],
  [/\b(read|reading|book|pages?)\b/i, '📚'],
  [/\b(french|fran[cç]ais)\b/i, '🇫🇷'],
  [/\b(spanish|espa[nñ]ol)\b/i, '🇪🇸'],
  [/\b(german|deutsch)\b/i, '🇩🇪'],
  [/\b(language|duolingo|vocab\w*)\b/i, '🗣️'],
  [/\b(study|studying|revision|revise|homework|class|lecture|course|exam)\b/i, '🎓'],
  [/\b(code|coding|leetcode|program\w*|project)\b/i, '💻'],
  [/\b(water|hydrat\w*)\b/i, '💧'],
  [/\b(sleep|bed|bedtime)\b/i, '😴'],
  [/\b(journal|diary|write|writing|blog)\b/i, '✍️'],
  [/\b(guitar|piano|music|practice|sing\w*)\b/i, '🎸'],
  [/\b(cook|cooking|meal|prep)\b/i, '🍳'],
  [/\b(clean|cleaning|tidy|laundry|chores?)\b/i, '🧹'],
  [/\b(call|phone|family|mum|mom|dad|parents)\b/i, '📞'],
  [/\b(pray|prayer|church|temple|mosque)\b/i, '🙏'],
  [/\b(vitamins?|meds?|medicine|pills?)\b/i, '💊'],
  [/\b(football|soccer)\b/i, '⚽'],
  [/\b(cricket)\b/i, '🏏'],
  [/\b(badminton)\b/i, '🏸'],
  [/\b(tennis|padel)\b/i, '🎾'],
  [/\b(basketball)\b/i, '🏀'],
  [/\b(budget|money|finance|savings?)\b/i, '💰'],
  [/\b(job|apply|applications?|cv|resume|linkedin)\b/i, '💼'],
  [/\b(no sugar|no junk|diet|healthy|fruit|veg\w*|salad)\b/i, '🥗'],
  [/\b(screen|phone[- ]free|social media|detox)\b/i, '📵'],
];

export function suggestEmoji(name: string): string {
  for (const [re, emoji] of RULES) if (re.test(name)) return emoji;
  return '✅';
}

export const EMOJI_CHOICES = [
  '🏋️', '🏃', '🚶', '🧘', '🏊', '🚴', '⚽', '🏸',
  '📚', '🎓', '💻', '✍️', '🇫🇷', '🗣️', '🎸', '🎨',
  '💧', '😴', '🥗', '💊', '🍳', '🧹', '📞', '🙏',
  '💰', '💼', '📵', '🌅', '🌿', '❤️', '⭐', '✅',
];

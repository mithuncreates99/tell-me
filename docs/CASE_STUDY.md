# Tell Me: product case study

## The problem

People start habits (gym, a language, reading) with good intentions and quietly drop them. Habit apps are meant to help, but many fail for the same reason: **logging is work**. Detailed trackers ask for sets, minutes or ratings, and once logging becomes a chore, the app stops being opened. With no data, there's no feedback, and the habit fades with the app.

## The insight

The smallest useful piece of data is binary: **did you show up, yes or no?** Asked at the right moment, it takes one tap. And Yes/No answers collected over a few weeks are already enough to see patterns that matter:

- which **day of the week** keeps failing,
- whether **morning or evening** habits stick better,
- which **habit** is slipping,
- and, with one optional extra tap on a No, **why** (tired, busy, forgot…).

## Who it's for

- **Students and young professionals** with a weekly routine that changes by day (classes, gym, side projects, language practice). This is me as a Master in Management student.
- People who have tried detailed trackers and dropped them.
- Privacy-conscious users who don't want another account.

## The product decisions

| Decision | Reasoning |
| --- | --- |
| **One question per habit, at the right time** | The notification *is* the interface. Answering takes a second, and on Android it doesn't even open the app. |
| **"Ask after"** (e.g. 1 h after the gym starts) | You can only answer "did you show up?" after the fact, so the reminder is timed for the moment the answer is known. |
| **Reasons are optional** | A forced reason form after every miss would bring back the friction we removed. One tap is enough to power the "why you miss" insight. |
| **Plain-English setup** | "Gym Mon Wed Fri 6pm" is faster than any form. Importing a whole schedule covers users who already have one written down. |
| **No account, data stays on the device** | No sign-up step at all, and nothing personal on a server. The cost is no multi-device sync yet, which is deliberately deferred. |
| **Insights instead of raw stats** | "Fridays are your weak spot" leads to an action. A table of percentages doesn't. Each insight needs a minimum amount of data so the app never over-claims. |
| **Weekly report notification** | A weekly moment of reflection, timed for Sunday evening when people plan their week. |
| **Demo mode** | New visitors (and recruiters) see a full report straight away instead of an empty screen. |

## What success would look like (metrics)

| Metric | Why it matters |
| --- | --- |
| **Check-in response rate** (answered ÷ asked), the North Star | If people answer, the core loop works. Everything else depends on it. |
| Share of answers given from the notification | Measures how much friction the one-tap design removes. |
| Completion rate trend per user (weeks 1→4) | Is the app actually helping people show up more? |
| Week-4 retention | Habit apps live or die by whether people are still around after a month. |
| Share of No answers with a reason | Tells whether the reason step is light enough. |

Measuring these privately would need opt-in, anonymous, aggregate analytics. Today nothing is tracked, by design.

## How it differs from typical habit trackers

Popular trackers like Streaks, HabitKit, Loop and Habitica each take their own approach. Tell Me's bet is narrower:

| | Typical habit tracker | **Tell Me** |
| --- | --- | --- |
| Logging | Open the app and tick (or fill in) each habit | **One tap, straight from the notification** |
| Reminder | Reminds you to *do* the habit | **Asks *whether* you did it, after the planned time** |
| Misses | Usually just a broken streak | **A one-tap reason that feeds "why you miss" insights** |
| Feedback | Charts and streaks | **Plain-language insights with minimum-data guards** |
| Platform & account | Native app per OS, often an account for sync | **A native iPhone app plus a web app for every other device. No account, data stays on the device** |

## What I'd test next

- **Ask-time A/B test.** Does asking 30 minutes after the planned time get more answers than 2 hours after?
- **Streak messaging.** Does showing the streak inside the notification raise the Yes rate?
- **Weekly report timing.** Sunday evening vs Monday morning.

## Roadmap

1. Encrypted sync across devices (optional account)
2. Flexible goals ("3 times a week", without fixed days)
3. French interface (my local market)
4. An opt-in AI-written weekly summary on top of the rule-based insights

## Results

_To be filled in after real use: my own completion rate over the first 4–8 weeks, how many people I shared it with, and their response rate._

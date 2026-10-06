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
- Friends who want to keep each other going: gym partners, study groups, language buddies.
- Privacy-conscious users who don't want another account (accounts are optional and have no email or password).

## The product decisions

| Decision | Reasoning |
| --- | --- |
| **One question per habit, at the right time** | The notification *is* the interface. Answering takes a second, and on Android it doesn't even open the app. |
| **"Ask after"** (e.g. 1 h after the gym starts) | You can only answer "did you show up?" after the fact, so the reminder is timed for the moment the answer is known. |
| **Reasons are optional** | A forced reason form after every miss would bring back the friction we removed. One tap is enough to power the "why you miss" insight. |
| **Plain-English setup** | "Gym Mon Wed Fri 6pm" is faster than any form. Importing a whole schedule covers users who already have one written down. |
| **Account optional, data stays on the device** | No sign-up step to start. When people want sync or friends, the account is a key instead of an email and password, and private data is end-to-end encrypted. |
| **Friends see only what you share** | Accountability works best with people you know, but nobody wants every habit public. Sharing is per habit, and reasons and notes are never shared. |
| **Nudges and reactions, not chat** | One tap to cheer (🔥) or nudge ("did you go yet?") keeps the social layer light and positive, with no inbox to manage. A nudge is limited to once per habit and day so it never turns into nagging. |
| **Weekly challenges** | A shared, short goal ("Gym 3× this week") gives friends a reason to open the app together, and resets weekly so falling behind is never permanent. |
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
| Invites sent and accepted per user | Is the social loop spreading the app? |
| Response rate with vs without friends | The core hypothesis of the social layer: do people show up more when a friend can see it? |

Measuring these privately would need opt-in, anonymous, aggregate analytics. Today nothing is tracked, by design.

## How it differs from typical habit trackers

Popular trackers like Streaks, HabitKit, Loop and Habitica each take their own approach. Tell Me's bet is narrower:

| | Typical habit tracker | **Tell Me** |
| --- | --- | --- |
| Logging | Open the app and tick (or fill in) each habit | **One tap, straight from the notification** |
| Reminder | Reminds you to *do* the habit | **Asks *whether* you did it, after the planned time** |
| Misses | Usually just a broken streak | **A one-tap reason that feeds "why you miss" insights** |
| Feedback | Charts and streaks | **Plain-language insights with minimum-data guards** |
| Social | Usually none, or a public feed | **Friends see only habits you share: live check-ins, nudges, reactions, weekly challenges** |
| Platform & account | Native app per OS, often an email account for sync | **A native iPhone app plus a web app for every other device. Account optional, no email or password, end-to-end encrypted sync** |

## What I'd test next

- **Ask-time A/B test.** Does asking 30 minutes after the planned time get more answers than 2 hours after?
- **Streak messaging.** Does showing the streak inside the notification raise the Yes rate?
- **Weekly report timing.** Sunday evening vs Monday morning.
- **Nudge copy.** "Did you show up today?" vs a friend's name only. Which gets more Yes answers after a nudge?

## Roadmap

1. Push notifications for friends' nudges in the iPhone app (APNs)
2. Flexible goals ("3 times a week", without fixed days)
3. French interface (my local market)
4. An opt-in AI-written weekly summary on top of the rule-based insights

## Results

_To be filled in after real use: my own completion rate over the first 4–8 weeks, how many people I shared it with, and their response rate._

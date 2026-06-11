# Changa OneView — Demo Runbook

The click-path, checks, and fallbacks for presenting OneView to the Changa team.
Live site: **https://changaenergydashboard.vercel.app/v2**

---

## Before the demo

**The day before**
1. Open `https://changaenergydashboard.vercel.app/api/v2/health` — verdict must be `ready`.
   If anything says `ok: false`, fix it now, not on demo day.
2. Send a **test report** (Reports page) and a **test alarm** (Alert Centre) to the exact
   email address that will be shown in the room. Confirm both land in the **inbox** —
   if either hits spam, mark "not spam" so demo-day delivery is clean.
3. Download the PDF report (Reports → Download PDF) and keep it on the laptop.
   This is the fallback if venue internet dies.

**One hour before**
1. Hit `/api/v2/health` again — verdict `ready`.
2. Open the dashboard, check the Command Centre shows live data (the "last updated"
   stamp in the header should be minutes old, not hours).
3. Have a phone on the table, signed into the inbox you'll send tests to. The phone
   buzzing is the demo moment — make sure notifications are ON and loud.

---

## The demo path (~10 minutes)

| # | Where | What to show | What to say |
|---|---|---|---|
| 1 | `/v2` | The branded entry screen | "One console for the entire fleet — every manufacturer." |
| 2 | Command Centre | Live fleet: online count, generation now, today's Rand value | "This is live, right now — not a mock-up." |
| 3 | Fleet Map | Sites across the provinces | "Your whole footprint at a glance." |
| 4 | Stations → one site | Per-site live power, yield, status | Pick a site that's generating well today. |
| 5 | Financials | Savings, PPA revenue, carbon — labelled estimates | "Energy is metered; money is the story it tells." |
| 6 | Alert Centre | Severity-ranked feed of what needs a human | "Nobody watches 21 sites by hand." |
| 7 | **Alert Centre → Send test alarm** | Type a Changa person's email, press send | **The phone buzzes.** "That's what 2am looks like — site name, what happened, one tap to the site." |
| 8 | Reports | The daily report: preview, then **Send test report** to the same phone | "And this lands every evening at 19:30, after the solar day ends — the whole day's numbers, automatically." |
| 9 | Reports → Download PDF | The boardroom artefact | "Same report as a PDF for anyone who wants paper." |
| 10 | Close | Recipients box on Reports page | "Add a name here and they're on the morning list — that's the whole setup." |

The two **send moments (7 and 8) are the peak** — let the phone interrupt you. Don't
talk over the buzz; pick the phone up and show the email.

---

## If something goes wrong

- **No internet / projector dies** → show the downloaded PDF + walk the printed flow.
- **Test email doesn't arrive in 30s** → check spam once, then move on smoothly:
  "It'll be in the inbox by the time we finish — let me show you the PDF version."
  (Check `/api/v2/health` after the meeting.)
- **A site looks offline during the demo** → that's a feature, not a bug: jump to the
  Alert Centre and show the alert describing exactly that outage.
- **Send button says limit reached** → the shared 10/hour test cap was hit during
  rehearsal. Wait, or demo with the preview (`Open report`) instead.

---

## Questions they will ask — honest answers

**"Where are GoodWe and Atess?"**
The console is built OEM-agnostic — LIVOLTEK and FusionSolar are live today, and the
grouping you see per manufacturer is where the next two slot in. GoodWe needs their
NDA process; Atess is waiting on datalogger serials from the EPC. The software side
is ready; access is the blocker.

**"Where's the login?"**
Deliberately open for this demo so you can click around freely. Authentication and
per-user roles are a roadmap item before client-facing rollout.

**"Are the Rand figures real?"**
Energy is metered live from each portal. Rand values apply labelled tariff
assumptions (configurable) — they're estimates and marked as such everywhere.

**"What does it cost to run?"**
Current footprint runs on free/hobby tiers (Vercel, Supabase, Resend). Scaling to
more sites changes that modestly — the architecture doesn't change.

---

## Email behaviour (reference)

- **Daily fleet report** — automatic, 19:30 SAST, full day's data, to the recipient
  list on the Reports page.
- **Test sends** — Reports page (report) and Alert Centre (digest / single alarm).
  Go to ONE typed address only; never touch the recipient list; capped at 10/hour.
- **Test alarm** — carries the most severe real alert; if the fleet is all clear it
  sends a clearly-labelled simulated outage instead.

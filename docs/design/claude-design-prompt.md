Design a personal budgeting app for iPhone. It is a PWA added to the home screen, so it should feel like a native iOS app. It has exactly one user, me. Transactions sync automatically from my German ING bank account once a day, so I never type in expenses by hand. The app's job is to tell me, at a glance, where my money went this month and how close I am to each limit.

## Feel

It should look like an independent designer spent months on it. It must not look like a generated dashboard. Think of a well-made physical object: calm, precise and confident, with personality in the details rather than in decoration.

Avoid all of these AI-template patterns:
- purple/blue gradients, glassmorphism, glowing blobs, neon accents
- every element in its own rounded card with a soft drop shadow
- emoji used as icons, sparkle icons, "✨ Insights"
- generic hero numbers with a green "+12%" pill beside them
- Inter everywhere, uniformly medium weights, everything centered
- filler copy such as "Track your finances effortlessly"

Aim for this instead:
- A strong typographic hierarchy where the numbers are the hero. Use tabular figures and set the cents smaller or lighter than the euros.
- Use SF Pro (the system font) so it feels native, but make deliberate size and weight contrasts.
- A restrained neutral base, warm off-white in light mode and true deep black in dark mode. Color appears only where it carries meaning, which is the categories and the status.
- Generous whitespace, alignment to a real grid, and hairline dividers instead of boxes wherever possible.
- Small, considered details: how a ring overflows when I go over budget, how a "paid" rent shows as settled, how empty states read.
- Plain, human microcopy with no exclamation marks. Example: "€28 left for groceries. 9 days to go."

## Core concept: budgets per area of life

Each category has a monthly limit and its own color. The palette must be harmonious, distinguishable in both light and dark mode, and must not be a rainbow. Example data (use realistic amounts and German merchants throughout):

| Category | Limit | Spent | Notes |
|---|---|---|---|
| Rent | €950 | €950 | Fixed, paid on the 1st, shown as settled |
| Groceries | €200 | €172.40 | REWE, Lidl, Edeka. Close to the limit (86%). |
| Car | €180 | €203.10 | Shell, Aral, insurance. Over the limit. |
| Eating out | €120 | €64.00 | |
| Subscriptions | €45 | €38.97 | Spotify, iCloud, Netflix |
| Health | €60 | €12.50 | DM, pharmacy |
| Misc | €100 | €41.20 | |

Income for the month is €3,400 net salary. The current date is 21 October.

**Three budget states**, each of which must be clear without relying on color alone (use shape, position, label or fill style too):
1. **On track**: under 80%.
2. **Close**: 80–100%. The threshold is configurable per category.
3. **Over**: past 100%. Show the overspend amount explicitly. The visualization should physically show the excess, for example the ring continuing past a full loop, rather than just turning red.

## Screens

1. **Month overview (home)**
   - A ring or donut chart of spending by category, each in its own color.
   - Total spent compared with total budget.
   - A "safe to spend per day" figure for the rest of the month.
   - Days left in the month.
   - A compact list of all categories showing spent and limit plus their status.
   - Categories that are close or over float to the top.
   - Swipe or tap to move between months.

2. **Category detail**
   - A large progress visualization.
   - Spent, limit and remaining amounts.
   - The daily pace compared with the ideal pace, as a subtle line.
   - The category's transactions for the month.
   - A small comparison with the last 6 months.
   - For fixed costs like rent, show the paid date instead of a pace.

3. **Transactions**
   - Grouped by day with day totals.
   - Search and filters.
   - An **"Uncategorized" inbox** where I swipe or tap to assign categories. The app should learn the merchant so it categorizes automatically next time.
   - A transaction detail view with merchant, IBAN purpose text, category, and a note field.

4. **Budget setup**
   - Create and edit categories: name, color, icon, monthly limit, alert thresholds, and whether the category is a fixed cost.
   - Optionally, unused budget carries over to the next month.

5. **Notifications**
   - Design the iOS lock-screen push notifications for these cases:
     - approaching a limit (80%)
     - limit reached
     - limit exceeded
     - a large single transaction
     - the daily summary
     - sync failed or needs a TAN
   - Write the exact copy for each one.
   - Also design an in-app notification history.

6. **Settings**
   - Bank sync status: last sync time, account IBAN masked, and a "sync now" button.
   - Notification preferences.
   - Month start day, for example a payday on the 25th.
   - Export.

## Deliverables

- **A small design system:** color tokens for light and dark mode, including the category palette and the status colors; a type scale; spacing; and core components (ring chart, progress bar in all three states, transaction row, category row, segmented month switcher, bottom tab bar, empty states, notification).
- **High-fidelity screens** at iPhone 16 size (393×852) in both light and dark mode. Respect the safe areas and the home indicator. Touch targets must be at least 44pt, and nothing may depend on hover.
- **Key interactions annotated:** month swipe, categorizing in the inbox, ring tap-to-focus on a category, and pull to refresh.
- **Edge states:** the first day of a month, all categories over budget, a sync error, and an empty month.

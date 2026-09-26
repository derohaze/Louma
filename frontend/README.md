# Bot Console Hub

Lovable Prompt — Discord Bot Hosting Dashboard (Hostinger-style)

Build a SaaS dashboard for a service that hosts and manages Discord bots for customers (subscription-based — customers pay to have one or more bots running 24/7 on our servers). Copy the exact visual system from the attached reference screenshots (Hostinger's hPanel) — layout structure, colors, spacing, component shapes, and icon style — but change all the content to fit Discord bot hosting instead of VPS/web hosting. Use icons from https://hugeicons.com/icons/ throughout (the reference uses a similar clean duotone/stroke icon style — match that weight and style).

Visual system to replicate exactly

Layout shell:

Fixed top navbar (dark navy/near-black, e.g. #150E27 or similar deep indigo-black) spanning full width, containing: logo mark on the far left, a pill-shaped promo/notification badge next to it, and on the far right a pill-shaped "AI Agent" style button with a gradient border (purple-to-pink), a search icon, and a user avatar icon.

Left sidebar, same dark navy background as navbar, fixed width (~90-100px collapsed icon rail style as shown, or expandable — replicate the reference's icon-with-label-below vertical stack), containing top-level nav items each as an icon + small label stacked vertically (not side by side).

Below the sidebar's dark section, a secondary lighter sidebar panel (white/near-white) showing the expanded sub-navigation for whichever top-level item is active, with a breadcrumb-style header above it inside the light content area (Home icon > Section > Current page).

Main content area: light gray/off-white background (e.g. #F5F6FA or similar), with a subtle dotted/grid decorative pattern in the corner (visible top-right in the reference) — replicate that faint dot-grid texture.

Color palette (extract and reuse):

Background (main content): very light gray/lavender-white

Sidebar/navbar: deep navy-indigo, almost black with a slight purple tint

Primary accent: purple/violet (buttons like "إعادة تشغيل" / restart button, active nav highlight, chart lines) — a saturated violet-purple

Secondary accent: pink-to-purple gradient (used on the "Agent" pill button border and badges)

Card backgrounds: white with soft rounded corners and a very subtle border/shadow

Success/status green for "running" indicators

Chart sparklines: purple line on transparent/white background

Typography:

Clean geometric sans-serif throughout, bold for headings, medium weight for card labels, regular for body/values

Large bold numeric values inside stat cards (e.g. "26%", "5 GB / 50 GB") with a smaller label above or below

Core components to rebuild:

Top status card — a large white rounded card at the top of the main content area showing the "resource" being managed (in the reference: the VPS server with OS icon, status pill "قيد التشغيل"/Running, action buttons like Restart + a dropdown + "Web Terminal"). For us: replace with the Discord bot's identity card — bot avatar, bot name, status pill (Online/Offline/Restarting), a "Restart Bot" primary button (violet), a dropdown for more actions (Stop, Update, Delete), and an "Open Dashboard"/"Manage" button.

Below the identity row, three info chips in a horizontal row (in the reference: SSH username, IPv4, root access command with copy icons) — for us: Bot ID / Server invite copy link, Discord Application ID with copy icon, Support/Docs link.

Stat cards grid (2 rows x 3 columns as in the reference) — each card: icon-labeled title with a chevron (›) to drill in, a big metric number, and a small sparkline chart. In the reference these are CPU %, RAM %, Disk usage (with radial ring), Inbound traffic, Outbound traffic, Bandwidth (radial ring). For us, repurpose to bot-relevant metrics:

Commands Used (today) — sparkline

Uptime % — with radial ring like the disk usage card

RAM Usage — sparkline

Servers Joined (guild count) — sparkline

Messages Processed — sparkline

Bandwidth/Data Transfer — radial ring

Bottom row of small nav cards — in the reference: SSH Key / Firewall Rules / Backups & Snapshots / Malware Scanner, each as a small card with icon + label + chevron. For us: Bot Token & Auth / Command Permissions / Backups & Snapshots (bot config backups) / Error Log Scanner — same shape, icon + label + chevron.

Sidebar nav items (icon + label stacked): replace VPS-hosting concepts with bot-hosting concepts, e.g.:

Overview (لوحة عامة equivalent) — Dashboard

Bot Manager (replaces "مدير Docker"/Docker Manager) — manage individual bots like containers

Agent (keep similar — AI assistant for troubleshooting)

My Bots (replaces "مواقع إلكترونية"/Websites) — list of all bots under the account

Settings (Root password → Bot Token; IP → Webhook URL; Emergency Mode → Kill Switch; SSH Keys → API Keys)

Backups & Monitoring (bot config/database backups)

Security (rate-limit rules, permission scopes)

API / Developer access

DNS/Domain Manager → Custom Domain / Webhook Manager (if bot has a web dashboard component)

Email hosting → Notification Channels (Discord webhook alerts, email alerts on bot downtime)

Marketplace/Learning → Bot Templates / Marketplace (pre-built command packs) + Tutorials

Account dropdown menu (top-right avatar click) — same shape as the reference popup: account name + email at top, then list items: Account Info, Team/Share Access, Billing/Invoices, Security, Account Activity, Notification Settings, AI Memory/Preferences, Language, Learning Center, Hire an Expert, Dark Mode toggle, Log Out. Repurpose "Hire an Expert" → "Get Bot Setup Help" and keep the rest conceptually the same.

Global search modal (triggered by the search icon) — same layout as reference: search bar at top with Ctrl+K hint, filter pills below (Overview / Bots / Servers / Subscriptions — replacing Domains/VPS/Email/Subscriptions), then a "Most used" list with icon + title + subtitle rows (e.g. "Add a Bot" / Marketplace, "Subscriptions" / Invoices, "Notification Channels", "Account Info"), and a "Need help finding something?" prompt at the bottom right with an "Ask [Brand] Agent" button.

Icons

Pull all icons from hugeicons.com (https://hugeicons.com/icons/) matching the reference's icon weight/style (clean duotone or stroke-rounded line icons). Needed icon concepts: dashboard/grid, robot/bot, settings gear, backup/refresh-cycle, shield/security, key/API, globe/domain, mail/notification, book/learning, server/CPU chip, memory/RAM chip, disk/storage, upload arrow, download arrow, bandwidth/signal, SSH key, firewall/shield-check, camera/snapshot, malware/bug-scan, search, user/account, copy-to-clipboard, chevron-right, external-link.

Interaction & structure notes

Keep the exact spacing rhythm, card corner radius, and grid proportions of the reference (2-column top info row, 3x2 stat grid below it, 4-across small nav cards at the bottom).

Keep the dotted background texture in the main content area's empty corners.

Support RTL Arabic layout AND an LTR English toggle (the reference is in Arabic RTL — build the component structure to support both).

Status pill colors: green = bot online, gray = offline, amber/orange = restarting/updating, red = error/crashed.

Make the whole thing feel like a control panel for infrastructure (server-grade, technical, trustworthy) rather than a playful Discord-bot toy — same tone as the reference's VPS panel.

Content/copy tone

Plain, direct, technical labels — no marketing fluff. Buttons say exactly what they do ("Restart Bot," "Add Bot," "Copy Token"). Empty states should say what's missing and offer the fix (e.g., no bots yet → "You haven't added a bot yet" + "Add your first bot" button).

Reference images attached: 4 screenshots of Hostinger's hPanel (VPS overview page, global search modal, account dropdown menu, VPS settings page). Match their layout, colors, spacing, and icon style pixel-for-pixel where possible; only the text content and icon subject matter change to fit a Discord bot hosting product.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1f886e58-d52f-4688-8240-4dd986c2bd1e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

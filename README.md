# Quarks Quacks — Points System

Team registration, event sign-ups, QR-based points, and a live leaderboard for the Quarks Quacks creative carnival at IISc Bangalore (11 October 2026).

## Setup

```bash
npm install
node server.js          # runs on http://localhost:3001
```

The SQLite database (`quarks-points.db`) is created automatically on first run with 27 seeded events and a superuser account.

### Superuser

A superuser account is seeded on first run (see `db.js`). Ask the organisers for credentials; never commit them here.

### Email (OTP verification)

OTP is sent to the captain's email on team registration. Without SMTP config, the OTP is logged to the server console.

```bash
SMTP_HOST=smtp.gmail.com SMTP_USER=you@gmail.com SMTP_PASS=xxxx-xxxx-xxxx-xxxx node server.js
```

Gmail app passwords: https://myaccount.google.com/apppasswords

## How it works

### Teams

1. Register with team name + 1–3 members (captain's email required)
2. Captain receives a 6-digit OTP via email
3. Enter OTP on the verify page to activate the team
4. Team logs in by name (no password — lookup only)

### Points

**Direct award** — Admin types team name (autocomplete), enters points + reason, clicks "Award Directly".

**QR flow** — Admin clicks "Generate QR" instead. A single-use, team-locked QR is created. The team scans it from their dashboard to claim points. The QR can only be used once and only by the intended team.

### Events

Teams can register for individual workshops/competitions from their dashboard. Clicking any event name opens a detail popup pulled from the [Google Sheet schedule](https://docs.google.com/spreadsheets/d/1jy7Jz381dNNlzTdndmrp4yC_uZbKBH53qeqPHsxaRU8).

### Roles

| Role | Access |
|------|--------|
| **Superuser** | Full dashboard — manage admins, register teams, award points, view all teams |
| **Admin** | Award points (scoped to their event), view teams |
| **Team** | View dashboard, QR code, registered events, scan points QR, leaderboard |

## Stack

- **Backend**: Node.js, Express, better-sqlite3, bcryptjs, jsonwebtoken, nodemailer, qrcode
- **Frontend**: Vanilla JS SPA with hash routing, retro pixel-themed UI
- **Auth**: JWT in httpOnly cookies (admin), localStorage (team sessions)

## Project structure

```
server.js             Express app + static server
db.js                 SQLite schema, seeds, migrations
auth.js               JWT middleware (requireAuth, requireRole)
mailer.js             Nodemailer OTP sender
routes/
  auth-routes.js      POST /login, /logout, GET /me
  team-routes.js      Registration, verification, lookup, search, event registrations, QR
  points-routes.js    Award, leaderboard, QR token generation + claim
  admin-routes.js     CRUD admins (superuser only)
public/
  index.html          SPA shell
  style.css           Retro pixel theme with 4-color system
  app.js              Client-side routing, forms, QR scanner, event popups
```

## License

Internal use — Quarks, IISc Bangalore.

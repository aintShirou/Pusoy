# Pusoy Barkada Online

Real-time 2–4 player Pusoy Dos web game using Node.js, Express and Socket.IO.

## Current features
- Pusoy Dos 52-card deck
- 3♣ opens the first trick
- Single, pair, triple and 5-card poker combinations
- 5-card poker hierarchy: straight < flush < full house < four of a kind < straight flush
- A higher 5-card category can beat a lower one (for example, four of a kind beats a full house)
- Multi-round elimination until one player remains
- Bots with automatic play
- Host can add/remove bots before starting
- Host-only Play Again button
- Betting pot: 1,000 starting chips, 10-chip ante, one +10 raise per betting round, call/fold
- Final remaining player receives the pot
- Real-time Socket.IO state synchronization

## Run locally
```bash
npm install
npm start
```

Open http://localhost:3000.

## Render
Use a Web Service:
- Build Command: `npm install`
- Start Command: `npm start`

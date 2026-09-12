# Pusoy Barkada Online

A vanilla HTML/CSS/JavaScript real-time Pusoy Dos table using Node.js + Express + Socket.IO.

## Included
- 2–4 players per room
- 5-character room codes
- Real-time private hands
- 52-card deck, 13 cards each for 4 players
- Filipino Pusoy Dos order: 3 → 4 → … → A → 2
- Filipino suit tie-break order: ♣ < ♠ < ♥ < ♦
- 3♣ must be included in the first play
- Singles, pairs, triples, straights, flushes, full houses, four-of-a-kind, straight flushes
- Pass / trick reset
- First player to empty their hand wins
- Responsive mobile/desktop UI

## Run locally
```bash
npm install
npm start
```
Open http://localhost:3000 in four browser tabs/devices. Create a room and share the room code.

## Deploy
This app needs a long-lived Node.js process for Socket.IO. Use a Node service such as Render, Railway, Fly.io, or a VPS. A Vercel serverless function is not the right place for the Socket.IO game server.

Set the start command to:
```bash
npm start
```

## Notes on rules
Pusoy Way is another name used for Filipino Pusoy/Chinese Poker: 13 cards arranged into Front 3, Middle 5, Back 5, with Back > Middle > Front. Pusoy Dos is a different shedding game. This first build implements the real-time Pusoy Dos table; the UI reserves a Pusoy Way mode for the next game engine.

House rules vary, especially suit order, whether bombs can interrupt other five-card hands, and scoring. The implementation uses the Filipino-style 3♣ opening and ♣ < ♠ < ♥ < ♦ suit order documented in the included research.

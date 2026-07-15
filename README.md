<div align="center">

# 🎲 Ludo Yaar

### Real-time Multiplayer Ludo — Play Anywhere, Anytime

[![Node.js](https://img.shields.io/badge/Node.js-v22.12.0+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)
[![Railway](https://img.shields.io/badge/Railway-Deployed-0B0D0E?style=for-the-badge&logo=railway&logoColor=white)](https://railway.app)

<br/>

*A premium, browser-based Ludo game with real-time multiplayer, social features, and a polished modern UI — built entirely with Vanilla JS and Socket.io.*

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [How to Play](#-how-to-play)
- [Deployment](#-deployment)
- [Project Structure](#-project-structure)

---

## 🌐 Overview

**Ludo Yaar** is a fully browser-based, real-time multiplayer Ludo game designed for 2–4 players. It brings the classic board game experience online with modern visuals, social tools, and strategic gameplay elements inspired by Ludo Star.

Players can create private rooms, invite friends via a room code, and enjoy a fluid, animated game session — all without any app installation.

---

## ✨ Features

### 🕹️ Gameplay
| Feature | Description |
|---|---|
| **Real-Time Multiplayer** | Up to 4 players per room, live-synced via WebSockets |
| **Private Rooms** | Create a room and share a code — friends join instantly |
| **Strategic Junctions** | At the end of a lap, choose **Home** or **another Lap** for strategic play |
| **POV Board Rotation** | Each player always sees their own base at the bottom-left |
| **Auto Turn Timer** | 10-second timer per turn; disconnected players are handled gracefully |

### 💬 Social
| Feature | Description |
|---|---|
| **Text Chat** | In-game chat panel visible to all room players |
| **Emoji Reactions** | Tap an emoji — watch it float across the board |
| **Voice Chat** | WebRTC-based signaling with per-player mute/unmute controls |

### 🎨 Visuals
| Feature | Description |
|---|---|
| **Glassmorphism UI** | Frosted-glass panels and layered depth effects |
| **3D Dice Animations** | Smooth, physics-inspired dice roll animations |
| **Particle Effects** | Burst effects on kills and token movements |
| **Animated Avatars** | Avatars glow and pulse on the active player's turn |

---

## 🚀 Tech Stack

```
┌─────────────────────────────────────────────────────────┐
│                     LUDO YAAR                           │
├──────────────────┬──────────────────────────────────────┤
│   Frontend       │  HTML5 Canvas · Vanilla JS · Vite    │
│   Backend        │  Node.js · Express                   │
│   Real-time      │  Socket.io (WebSockets)              │
│   Deployment     │  Docker · Railway.app                │
└──────────────────┴──────────────────────────────────────┘
```

---

## 🛠️ Getting Started

### Prerequisites

- **Node.js** v22.12.0 or higher → [Download](https://nodejs.org)
- **npm** (bundled with Node.js)

### 1. Clone the Repository

```bash
git clone <repository-url>
cd ludo
```

### 2. Install Dependencies

```bash
npm install
```

> This installs dependencies for both the `server` and `website` packages via the root script.

### 3. Run Locally

You need **two terminals** running simultaneously:

```bash
# Terminal 1 — Start the backend
cd server
npm run dev
```

```bash
# Terminal 2 — Start the frontend
cd website
npm run dev
```

Open your browser and navigate to:

```
http://localhost:3000
```

---

## 🎮 How to Play

```
Step 1 → Enter your name and open the lobby
Step 2 → Create a room (share the code) or Join an existing room
Step 3 → Wait for 2–4 players to be ready
Step 4 → Roll the dice — need a 6 to release a token from base
Step 5 → Move tokens clockwise around the board
Step 6 → Land on an opponent's token to send it back to base (kill!)
Step 7 → Reach the junction — choose "Home" or take another Lap
Step 8 → First to get all 4 tokens home wins 🏆
```

> **⚠️ Rule:** Rolling three 6s in a row forfeits your turn automatically.

---

## 📦 Deployment

The project ships with full **Railway.app** and **Docker** support out of the box.

### Railway (Recommended)

Simply connect your repository to Railway — the `railway.toml` handles the rest.

### Manual / Docker

```bash
# Build the frontend
npm run build

# Start the production server
npm start
```

```bash
# Or run with Docker
docker build -t ludo-yaar .
docker run -p 3000:3000 ludo-yaar
```

---

---

## 📄 License

This project is intended for educational and personal use.

---

<div align="center">

Made with ❤️ by the **Ludo Yaar** Team

</div>

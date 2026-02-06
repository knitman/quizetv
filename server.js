import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 8080;

/* STATIC */
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "intro.html"))
);

/* QUESTIONS */
const questions = JSON.parse(
  fs.readFileSync(path.join(__dirname, "questions.json"), "utf-8")
);

/* GAME STATE */
let qIndex = 0;
let gameStarted = false;
let answers = [];
let startTime = 0;
let countdownRunning = false;

const players = new Map(); // ws -> { name, score, ready }

/* HELPERS */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

function broadcastPlayers() {
  broadcast({
    type: "players",
    players: [...players.values()]
  });
}

function allReady() {
  const list = [...players.values()];
  return list.length > 0 && list.every(p => p.ready);
}

/* AUTO START CHECK */
function tryAutoStart() {
  if (gameStarted || countdownRunning) return;
  if (!allReady()) return;

  countdownRunning = true;
  startCountdown();
}

/* SOCKETS */
wss.on("connection", ws => {

  ws.on("message", raw => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === "join") {
      players.set(ws, { name: data.name, score: 0, ready: false });
      broadcastPlayers();
    }

    if (data.type === "ready") {
      const p = players.get(ws);
      if (p) {
        p.ready = true;
        broadcastPlayers();
        tryAutoStart(); // 🔥 ΕΔΩ ΓΙΝΕΤΑΙ ΤΟ AUTO START
      }
    }

    if (data.type === "answer" && gameStarted) {
      answers.push({
        ws,
        answer: data.answer,
        time: Date.now() - startTime
      });

      broadcast({
        type: "answer_live",
        answer: data.answer
      });
    }
  });

  ws.on("close", () => {
    players.delete(ws);
    broadcastPlayers();
  });
});

/* COUNTDOWN */
function startCountdown() {
  let seconds = 5;
  broadcast({ type: "countdown", seconds });

  const timer = setInterval(() => {
    seconds--;
    broadcast({ type: "countdown", seconds });

    if (seconds === 0) {
      clearInterval(timer);
      gameStarted = true;
      countdownRunning = false;
      qIndex = 0;
      nextQuestion();
    }
  }, 1000);
}

/* GAME FLOW */
function nextQuestion() {
  if (qIndex >= questions.length) {
    broadcast({ type: "end", players: [...players.values()] });
    return;
  }

  answers = [];
  startTime = Date.now();

  broadcast({
    type: "question",
    question: questions[qIndex],
    index: qIndex + 1
  });

  qIndex++;
  setTimeout(evaluateAnswers, 10000);
}

function evaluateAnswers() {
  const q = questions[qIndex - 1];
  const correct = answers.filter(a => a.answer === q.correct);

  if (correct.length) {
    correct.forEach(a => players.get(a.ws).score += 1);
    const fastest = correct.sort((a,b)=>a.time-b.time)[0];
    players.get(fastest.ws).score += 1;

    broadcast({
      type: "winner",
      name: players.get(fastest.ws).name,
      correct: q.correct
    });
  }

  broadcastPlayers();
  setTimeout(nextQuestion, 3000);
}

server.listen(PORT, () =>
  console.log("✅ Server running on port", PORT)
);

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

/* =========================
   STATIC FILES
========================= */
app.use(express.static(path.join(__dirname, "public")));

/* ROOT -> intro */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "intro.html"));
});

/* =========================
   GAME STATE
========================= */
const questions = JSON.parse(
  fs.readFileSync(path.join(__dirname, "questions.json"), "utf-8")
);

let qIndex = 0;
let gameStarted = false;
let startTime = 0;
let answers = [];

const players = new Map(); // ws -> { name, score }
let qrDataUrl = "";

/* =========================
   QR CODE (PUBLIC URL)
========================= */
const BASE_URL =
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`;

QRCode.toDataURL(`${BASE_URL}/mobile.html`).then(url => {
  qrDataUrl = url;
});

/* =========================
   HELPERS
========================= */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

/* =========================
   WEBSOCKETS
========================= */
wss.on("connection", ws => {

  // ΣΤΕΙΛΕ QR ΜΕ ΤΗ ΣΥΝΔΕΣΗ (για intro / TV)
  ws.send(JSON.stringify({
    type: "qr",
    qr: qrDataUrl
  }));

  ws.on("message", raw => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.type === "join") {
      players.set(ws, { name: data.name, score: 0 });
      broadcast({ type: "players", players: [...players.values()] });
    }

    if (data.type === "admin_start" && !gameStarted) {
      gameStarted = true;
      nextQuestion();
    }

    if (data.type === "answer" && gameStarted) {
      answers.push({
        ws,
        answer: data.answer,
        time: Date.now() - startTime
      });
    }
  });

  ws.on("close", () => {
    players.delete(ws);
    broadcast({ type: "players", players: [...players.values()] });
  });
});

/* =========================
   GAME FLOW
========================= */
function nextQuestion() {
  if (qIndex >= questions.length) {
    broadcast({
      type: "end",
      players: [...players.values()]
    });
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

  if (correct.length > 0) {
    // όλοι οι σωστοί +1
    correct.forEach(a => {
      players.get(a.ws).score += 1;
    });

    // πιο γρήγορος +1
    const fastest = correct.sort((a, b) => a.time - b.time)[0];
    players.get(fastest.ws).score += 1;

    broadcast({
      type: "winner",
      name: players.get(fastest.ws).name
    });
  }

  broadcast({ type: "players", players: [...players.values()] });
  setTimeout(nextQuestion, 3000);
}

/* =========================
   START SERVER
========================= */
server.listen(PORT, () => {
  console.log("✅ Server running on port", PORT);
});

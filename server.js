import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import QRCode from "qrcode";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 8080;

app.use(express.static("public"));

const questions = JSON.parse(fs.readFileSync("questions.json"));
let qIndex = 0;
let answers = [];
let startTime = 0;
let gameStarted = false;

const players = new Map();
let qrUrl = "";

QRCode.toDataURL("REPLACE_WITH_RENDER_URL/mobile.html")
  .then(url => qrUrl = url);

function broadcast(data) {
  wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(data)));
}

wss.on("connection", ws => {
  ws.on("message", msg => {
    const data = JSON.parse(msg);

    if (data.type === "join") {
      players.set(ws, { name: data.name, score: 0 });
      broadcast({ type: "players", players: [...players.values()] });
    }

    if (data.type === "admin_start" && !gameStarted) {
      gameStarted = true;
      nextQuestion();
    }

    if (data.type === "answer") {
      answers.push({
        ws,
        answer: data.answer,
        time: Date.now() - startTime
      });
    }
  });
});

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
    index: qIndex + 1,
    qr: qrUrl
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
    broadcast({ type: "winner", name: players.get(fastest.ws).name });
  }

  broadcast({ type: "players", players: [...players.values()] });
  setTimeout(nextQuestion, 3000);
}

server.listen(PORT, () => {
  console.log("Running on port", PORT);
});

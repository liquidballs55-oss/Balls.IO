import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

const PORT = 3000;

interface Point {
  x: number;
  y: number;
}

interface Player {
  id: string;
  name: string;
  color: string;
  score: number;
  segments: Point[];
  angle: number;
  isBot?: boolean;
  isBoosting?: boolean;
}

interface Food {
  id: string;
  x: number;
  y: number;
  color: string;
  value: number;
}

const WORLD_SIZE = 5000;
const INITIAL_SEGMENTS = 10;
const SEGMENT_DISTANCE = 15;
const MAX_BOTS = 30;
const BOOST_SPEED = 6;
const NORMAL_SPEED = 3;

let players: Record<string, Player> = {};
let foods: Food[] = [];

// Initialize food
for (let i = 0; i < 500; i++) {
  spawnFood();
}

function spawnFood(x?: number, y?: number, color?: string, value?: number) {
  foods.push({
    id: Math.random().toString(36).substr(2, 9),
    x: x ?? Math.random() * WORLD_SIZE,
    y: y ?? Math.random() * WORLD_SIZE,
    color: color ?? `hsl(${Math.random() * 360}, 70%, 60%)`,
    value: value ?? 1,
  });
}

function spawnBot() {
  const id = `bot_${Math.random().toString(36).substr(2, 9)}`;
  const startX = Math.random() * WORLD_SIZE;
  const startY = Math.random() * WORLD_SIZE;
  const color = `hsl(${Math.random() * 360}, 60%, 40%)`;
  const names = ["Baller", "Sphere", "Orbital", "Roundy", "Globular", "Curvy", "Bouncer", "Rolling", "Circular", "Smooth"];
  const name = `[BOT] ${names[Math.floor(Math.random() * names.length)]}`;

  const segments: Point[] = [];
  for (let i = 0; i < INITIAL_SEGMENTS; i++) {
    segments.push({ x: startX, y: startY + i * SEGMENT_DISTANCE });
  }

  players[id] = {
    id,
    name,
    color,
    score: 0,
    segments,
    angle: Math.random() * Math.PI * 2,
    isBot: true,
    isBoosting: false,
  };
}

// Initial bots
for (let i = 0; i < MAX_BOTS; i++) {
  spawnBot();
}

function updateBotAI(bot: Player) {
  const head = bot.segments[0];
  const detectionRadius = 150;
  let avoidanceVector = { x: 0, y: 0 };
  let foundObstacle = false;

  // 1. Avoidance (Steer away from other players and own tail)
  for (const other of Object.values(players)) {
    // Skip self head, but check self body (starting from segment 5 to avoid self-collision with neck)
    const startIdx = other.id === bot.id ? 5 : 0;
    for (let i = startIdx; i < other.segments.length; i++) {
      const seg = other.segments[i];
      const dx = head.x - seg.x;
      const dy = head.y - seg.y;
      const distSq = dx * dx + dy * dy;
      
      if (distSq < detectionRadius * detectionRadius) {
        const dist = Math.sqrt(distSq);
        // Vector pointing AWAY from obstacle
        avoidanceVector.x += (dx / dist) * (detectionRadius - dist);
        avoidanceVector.y += (dy / dist) * (detectionRadius - dist);
        foundObstacle = true;
      }
    }
  }

  // 2. Boundary avoidance
  const margin = 200;
  if (head.x < margin) avoidanceVector.x += (margin - head.x);
  if (head.x > WORLD_SIZE - margin) avoidanceVector.x -= (head.x - (WORLD_SIZE - margin));
  if (head.y < margin) avoidanceVector.y += (margin - head.y);
  if (head.y > WORLD_SIZE - margin) avoidanceVector.y -= (head.y - (WORLD_SIZE - margin));
  
  if (avoidanceVector.x !== 0 || avoidanceVector.y !== 0) foundObstacle = true;

  if (foundObstacle) {
    const targetAngle = Math.atan2(avoidanceVector.y, avoidanceVector.x);
    let diff = targetAngle - bot.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    bot.angle += diff * 0.2;
    
    // Bots boost when in danger
    bot.isBoosting = bot.segments.length > 15 && Math.random() > 0.8;
    return;
  }

  // 3. Hunting / Killing logic
  // If a player is nearby, try to cut them off
  for (const other of Object.values(players)) {
    if (other.id === bot.id) continue;
    const otherHead = other.segments[0];
    const dx = otherHead.x - head.x;
    const dy = otherHead.y - head.y;
    const distSq = dx * dx + dy * dy;
    
    if (distSq < 300 * 300) {
      // Predict where they will be
      const predictionFactor = 20;
      const targetX = otherHead.x + Math.cos(other.angle) * predictionFactor;
      const targetY = otherHead.y + Math.sin(other.angle) * predictionFactor;
      
      const targetAngle = Math.atan2(targetY - head.y, targetX - head.x);
      let diff = targetAngle - bot.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      bot.angle += diff * 0.15;
      bot.isBoosting = bot.segments.length > 20;
      return;
    }
  }

  // 4. Food seeking (Prioritize high value orbs)
  let bestFood = null;
  let maxScore = -1;
  const seekRadiusSq = 1000 * 1000;
  
  for (let i = 0; i < foods.length; i++) {
    const food = foods[i];
    const dx = food.x - head.x;
    const dy = food.y - head.y;
    const distSq = dx * dx + dy * dy;
    
    if (distSq < seekRadiusSq) {
      // Score food based on value and distance
      const score = food.value / (Math.sqrt(distSq) + 1);
      if (score > maxScore) {
        maxScore = score;
        bestFood = food;
      }
    }
  }

  if (bestFood) {
    const targetAngle = Math.atan2(bestFood.y - head.y, bestFood.x - head.x);
    let diff = targetAngle - bot.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    bot.angle += diff * 0.1;
  } else {
    // Just wander
    bot.angle += (Math.random() - 0.5) * 0.1;
  }
  
  bot.isBoosting = false;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
  }

  io.on("connection", (socket) => {
    socket.on("join", ({ name, color }: { name: string, color: string }) => {
      const startX = Math.random() * WORLD_SIZE;
      const startY = Math.random() * WORLD_SIZE;
      
      const segments: Point[] = [];
      for (let i = 0; i < INITIAL_SEGMENTS; i++) {
        segments.push({ x: startX, y: startY + i * SEGMENT_DISTANCE });
      }

      players[socket.id] = {
        id: socket.id,
        name: name || "Anonymous Ball",
        color: color || `hsl(${Math.random() * 360}, 80%, 50%)`,
        score: 0,
        segments,
        angle: -Math.PI / 2,
        isBoosting: false,
      };

      socket.emit("init", {
        id: socket.id,
        worldSize: WORLD_SIZE,
      });
    });

    socket.on("update_angle", (angle: number) => {
      if (players[socket.id]) {
        players[socket.id].angle = angle;
      }
    });

    socket.on("update_boost", (isBoosting: boolean) => {
      if (players[socket.id]) {
        players[socket.id].isBoosting = isBoosting;
      }
    });

    socket.on("disconnect", () => {
      delete players[socket.id];
    });
  });

  // Game Loop
  let tick = 0;
  setInterval(() => {
    tick++;
    // Maintain bot count
    const currentBots = Object.values(players).filter(p => p.isBot).length;
    if (currentBots < MAX_BOTS) {
      spawnBot();
    }

    Object.values(players).forEach((player) => {
      if (player.isBot) {
        updateBotAI(player);
      }

      const isBoosting = player.isBoosting && player.segments.length > 5;
      const speed = isBoosting ? BOOST_SPEED : NORMAL_SPEED;
      const head = player.segments[0];
      
      // Move head
      const newHead = {
        x: head.x + Math.cos(player.angle) * speed,
        y: head.y + Math.sin(player.angle) * speed,
      };

      // Boundary check
      if (newHead.x < 0) newHead.x = 0;
      if (newHead.x > WORLD_SIZE) newHead.x = WORLD_SIZE;
      if (newHead.y < 0) newHead.y = 0;
      if (newHead.y > WORLD_SIZE) newHead.y = WORLD_SIZE;

      // Update segments
      const newSegments = [newHead];
      let prev = newHead;
      
      for (let i = 1; i < player.segments.length; i++) {
        const curr = player.segments[i];
        const dx = prev.x - curr.x;
        const dy = prev.y - curr.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > SEGMENT_DISTANCE) {
          const angle = Math.atan2(dy, dx);
          newSegments.push({
            x: prev.x - Math.cos(angle) * SEGMENT_DISTANCE,
            y: prev.y - Math.sin(angle) * SEGMENT_DISTANCE,
          });
        } else {
          newSegments.push(curr);
        }
        prev = newSegments[i];
      }
      player.segments = newSegments;

      // Boost penalty: lose score/segments
      if (isBoosting && tick % 10 === 0) {
        player.score = Math.max(0, player.score - 0.5);
        if (tick % 30 === 0 && player.segments.length > 5) {
          const dropped = player.segments.pop();
          if (dropped) {
            spawnFood(dropped.x, dropped.y, player.color, 2);
          }
        }
      }

      // Food collision
      foods = foods.filter((food) => {
        const dx = newHead.x - food.x;
        const dy = newHead.y - food.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 25 * 25) {
          player.score += food.value;
          // Add segment every few points
          if (Math.floor(player.score) > Math.floor(player.score - food.value)) {
             const last = player.segments[player.segments.length - 1];
             player.segments.push({ ...last });
          }
          spawnFood();
          return false;
        }
        return true;
      });

      // Player collision
      Object.values(players).forEach((other) => {
        if (other.id === player.id) return;
        
        other.segments.forEach((seg, idx) => {
          const dx = newHead.x - seg.x;
          const dy = newHead.y - seg.y;
          const distSq = dx * dx + dy * dy;
          
          if (distSq < 18 * 18) {
            player.segments.forEach((s, sIdx) => {
              if (sIdx % 2 === 0) {
                spawnFood(s.x, s.y, player.color, 10);
              }
            });
            
            if (!player.isBot) {
              io.to(player.id).emit("game_over");
            }
            delete players[player.id];
          }
        });
      });
    });

    io.emit("game_state", {
      players: Object.values(players),
      foods,
    });
  }, 1000 / 60);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

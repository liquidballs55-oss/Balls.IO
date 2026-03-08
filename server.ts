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

interface Meteor {
  id: string;
  x: number;
  y: number;
  radius: number;
  strikeTime: number;
  isStruck: boolean;
}

const WORLD_SIZE = 5000;
const INITIAL_SEGMENTS = 10;
const SEGMENT_DISTANCE = 15;
const MAX_BOTS = 30;
const GRID_SIZE = 200;
const METEOR_EVENT_INTERVAL = 120000; // 2 minutes
const METEOR_WARNING_TIME = 3000; // 3 seconds warning
const METEOR_COUNT = 40;

function getPlayerRadius(score: number) {
  return 18 + Math.sqrt(score) * 1.5;
}

function getPlayerSpeed(score: number, isBoosting: boolean) {
  const baseSpeed = Math.max(1.5, 3.5 - Math.sqrt(score) * 0.05);
  return isBoosting ? baseSpeed * 2 : baseSpeed;
}

let players: Record<string, Player> = {};
let foods: Food[] = [];
let foodGrid: Record<string, Food[]> = {};
let meteors: Meteor[] = [];
let nextMeteorEvent = Date.now() + METEOR_EVENT_INTERVAL;
let isMeteorEventActive = false;

function getGridKey(x: number, y: number) {
  const gx = Math.floor(x / GRID_SIZE);
  const gy = Math.floor(y / GRID_SIZE);
  return `${gx},${gy}`;
}

function spawnFood(x?: number, y?: number, color?: string, value?: number, io?: Server) {
  const food = {
    id: Math.random().toString(36).substr(2, 9),
    x: x ?? Math.random() * WORLD_SIZE,
    y: y ?? Math.random() * WORLD_SIZE,
    color: color ?? `hsl(${Math.random() * 360}, 70%, 60%)`,
    value: value ?? 1,
  };
  foods.push(food);
  const key = getGridKey(food.x, food.y);
  if (!foodGrid[key]) foodGrid[key] = [];
  foodGrid[key].push(food);
  
  if (io) {
    io.emit("food_spawned", food);
  }
}

function startMeteorEvent(io: Server) {
  isMeteorEventActive = true;
  meteors = [];
  for (let i = 0; i < METEOR_COUNT; i++) {
    meteors.push({
      id: Math.random().toString(36).substr(2, 9),
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      radius: 100 + Math.random() * 150,
      strikeTime: Date.now() + METEOR_WARNING_TIME,
      isStruck: false,
    });
  }
  io.emit("meteor_warning", meteors);

  setTimeout(() => {
    meteors.forEach(m => m.isStruck = true);
    io.emit("meteor_strike");
    
    // Check collisions for all players
    Object.values(players).forEach(player => {
      const head = player.segments[0];
      const playerRadius = getPlayerRadius(player.score);
      
      for (const m of meteors) {
        const dx = head.x - m.x;
        const dy = head.y - m.y;
        const distSq = dx * dx + dy * dy;
        const collisionDist = playerRadius + m.radius;
        
        if (distSq < collisionDist * collisionDist) {
          // Player hit by meteor
          player.segments.forEach((s, sIdx) => {
            if (sIdx % 2 === 0) {
              spawnFood(s.x, s.y, player.color, 10, io);
            }
          });
          
          if (!player.isBot) {
            io.to(player.id).emit("game_over");
          }
          delete players[player.id];
          break;
        }
      }
    });

    setTimeout(() => {
      isMeteorEventActive = false;
      meteors = [];
      nextMeteorEvent = Date.now() + METEOR_EVENT_INTERVAL;
    }, 2000);
  }, METEOR_WARNING_TIME);
}

function spawnBot() {
  const id = `bot_${Math.random().toString(36).substr(2, 9)}`;
  const startX = Math.random() * WORLD_SIZE;
  const startY = Math.random() * WORLD_SIZE;
  const color = `hsl(${Math.random() * 360}, 60%, 40%)`;
  const names = ["Baller", "Sphere", "Orbital", "Roundy", "Globular", "Curvy", "Bouncer", "Rolling", "Circular", "Smooth"];
  const name = `[BOT] ${names[Math.floor(Math.random() * names.length)]}`;

  // Randomly spawn big bots
  const isBig = Math.random() > 0.8;
  const initialScore = isBig ? Math.random() * 200 + 50 : 0;
  const segmentsCount = INITIAL_SEGMENTS + Math.floor(initialScore / 2);

  const segments: Point[] = [];
  for (let i = 0; i < segmentsCount; i++) {
    segments.push({ x: startX, y: startY + i * SEGMENT_DISTANCE });
  }

  players[id] = {
    id,
    name,
    color,
    score: initialScore,
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
  const botRadius = getPlayerRadius(bot.score);
  
  // Skill scaling: 0 (dumb) to 1 (pro)
  const skill = Math.min(1, bot.score / 150); 
  
  const avoidanceRadius = (botRadius + 40) * (0.8 + skill * 0.7); 
  const huntingRadius = 400 + skill * 600; 
  
  let targetVector = { x: 0, y: 0 };
  let isHunting = false;
  let isAvoiding = false;

  // 1. Hunting Logic (High Priority)
  let nearestPlayer = null;
  let minPlayerDistSq = huntingRadius * huntingRadius;

  for (const other of Object.values(players)) {
    if (other.id === bot.id) continue;
    const otherHead = other.segments[0];
    const dx = otherHead.x - head.x;
    const dy = otherHead.y - head.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < minPlayerDistSq) {
      minPlayerDistSq = distSq;
      nearestPlayer = other;
    }
  }

  if (nearestPlayer) {
    const otherHead = nearestPlayer.segments[0];
    
    // Skill affects interception precision
    const angleToOther = Math.atan2(otherHead.y - head.y, otherHead.x - head.x);
    let angleDiff = angleToOther - bot.angle;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    const otherAngleToUs = Math.atan2(head.y - otherHead.y, head.x - otherHead.x);
    let otherAngleDiff = otherAngleToUs - nearestPlayer.angle;
    while (otherAngleDiff < -Math.PI) otherAngleDiff += Math.PI * 2;
    while (otherAngleDiff > Math.PI) otherAngleDiff -= Math.PI * 2;

    const isSpiral = Math.abs(angleDiff) > 1.0 && Math.abs(otherAngleDiff) > 1.0;

    if (isSpiral && minPlayerDistSq < (botRadius * 4) * (botRadius * 4)) {
      targetVector.x -= (otherHead.x - head.x);
      targetVector.y -= (otherHead.y - head.y);
    } else {
      // Skill affects lead factor
      const leadFactor = 30 + skill * 70; 
      const targetX = otherHead.x + Math.cos(nearestPlayer.angle) * leadFactor;
      const targetY = otherHead.y + Math.sin(nearestPlayer.angle) * leadFactor;
      
      targetVector.x += (targetX - head.x) * (1 + skill);
      targetVector.y += (targetY - head.y) * (1 + skill);
    }
    
    isHunting = true;
    
    // Skill affects boost usage
    if (minPlayerDistSq < (300 * 300) && bot.segments.length > 15 && !isSpiral && Math.random() < (0.1 + skill * 0.9)) {
      bot.isBoosting = true;
    }
  }

  // 2. Avoidance Logic (Critical Priority)
  for (const other of Object.values(players)) {
    const otherRadius = getPlayerRadius(other.score);
    const startIdx = other.id === bot.id ? 8 : 0; 
    for (let i = startIdx; i < other.segments.length; i++) {
      const seg = other.segments[i];
      const dx = head.x - seg.x;
      const dy = head.y - seg.y;
      const distSq = dx * dx + dy * dy;
      
      const combinedRadius = botRadius + otherRadius;
      const dangerZone = combinedRadius + avoidanceRadius;

      if (distSq < dangerZone * dangerZone) {
        const dist = Math.sqrt(distSq);
        // Skill affects how early and hard we steer away
        const force = (dangerZone - dist) * (2 + skill * 8);
        targetVector.x += (dx / dist) * force;
        targetVector.y += (dy / dist) * force;
        isAvoiding = true;
      }
    }
  }

  // 3. Boundary avoidance
  const margin = 200;
  if (head.x < margin) targetVector.x += margin * 2;
  if (head.x > WORLD_SIZE - margin) targetVector.x -= margin * 2;
  if (head.y < margin) targetVector.y += margin * 2;
  if (head.y > WORLD_SIZE - margin) targetVector.y -= margin * 2;

  // 4. Food seeking
  if (!isHunting && !isAvoiding) {
    let bestFood = null;
    let maxScore = -1;
    for (let i = 0; i < foods.length; i++) {
      const food = foods[i];
      const dx = food.x - head.x;
      const dy = food.y - head.y;
      const distSq = dx * dx + dy * dy;
      const score = food.value / (Math.sqrt(distSq) + 1);
      if (score > maxScore) {
        maxScore = score;
        bestFood = food;
      }
    }
    if (bestFood) {
      targetVector.x += (bestFood.x - head.x);
      targetVector.y += (bestFood.y - head.y);
    } else {
      targetVector.x += Math.cos(bot.angle + (Math.random() - 0.5)) * 100;
      targetVector.y += Math.sin(bot.angle + (Math.random() - 0.5)) * 100;
    }
  }

  if (targetVector.x !== 0 || targetVector.y !== 0) {
    const targetAngle = Math.atan2(targetVector.y, targetVector.x);
    let diff = targetAngle - bot.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    
    // Skill affects turning speed
    const turnSpeed = 0.08 + skill * 0.15; // Reduced turn speed to prevent jitter/spinning
    bot.angle += diff * turnSpeed;
  }

  // Decisive boosting: only boost if we are actually facing the target
  if (isHunting && bot.segments.length > 15) {
    const targetAngle = Math.atan2(targetVector.y, targetVector.x);
    let diff = targetAngle - bot.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    
    if (Math.abs(diff) < 0.5 && Math.random() < (0.1 + skill * 0.9)) {
      bot.isBoosting = true;
    } else {
      bot.isBoosting = false;
    }
  } else if (!isAvoiding) {
    bot.isBoosting = false;
  }
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
        foods: foods, // Send all food once on join
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

    // Meteor Event Trigger
    if (!isMeteorEventActive && Date.now() > nextMeteorEvent) {
      startMeteorEvent(io);
    }

    Object.values(players).forEach((player) => {
      if (player.isBot) {
        updateBotAI(player);
      }

      const isBoosting = player.isBoosting && player.segments.length > 5;
      const speed = getPlayerSpeed(player.score, isBoosting);
      const head = player.segments[0];
      const playerRadius = getPlayerRadius(player.score);
      
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
      
      const segmentDist = Math.max(10, playerRadius * 0.8);

      for (let i = 1; i < player.segments.length; i++) {
        const curr = player.segments[i];
        const dx = prev.x - curr.x;
        const dy = prev.y - curr.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > segmentDist) {
          const angle = Math.atan2(dy, dx);
          newSegments.push({
            x: prev.x - Math.cos(angle) * segmentDist,
            y: prev.y - Math.sin(angle) * segmentDist,
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

      // Food collision using spatial grid
      const gx = Math.floor(newHead.x / GRID_SIZE);
      const gy = Math.floor(newHead.y / GRID_SIZE);
      const collisionDist = playerRadius + 5;
      const collisionDistSq = collisionDist * collisionDist;

      // Check current and neighboring cells
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${gx + dx},${gy + dy}`;
          const cellFoods = foodGrid[key];
          if (!cellFoods) continue;

          for (let i = cellFoods.length - 1; i >= 0; i--) {
            const food = cellFoods[i];
            const fdx = newHead.x - food.x;
            const fdy = newHead.y - food.y;
            const distSq = fdx * fdx + fdy * fdy;

            if (distSq < collisionDistSq) {
              player.score += food.value;
              if (Math.floor(player.score) > Math.floor(player.score - food.value)) {
                const last = player.segments[player.segments.length - 1];
                player.segments.push({ ...last });
              }
              
              // Remove from grid and main list
              cellFoods.splice(i, 1);
              const foodIdx = foods.findIndex(f => f.id === food.id);
              if (foodIdx !== -1) foods.splice(foodIdx, 1);
              
              io.emit("food_eaten", food.id);
              spawnFood(undefined, undefined, undefined, undefined, io);
            }
          }
        }
      }

      // Player collision
      Object.values(players).forEach((other) => {
        const otherRadius = getPlayerRadius(other.score);
        const collisionDist = playerRadius + otherRadius * 0.8;
        const collisionDistSq = collisionDist * collisionDist;

        // Optimization: check head distance first
        const hdx = newHead.x - other.segments[0].x;
        const hdy = newHead.y - other.segments[0].y;
        const hdistSq = hdx * hdx + hdy * hdy;
        
        // If too far from other player's head and they are short, skip detailed check
        if (hdistSq > 1500 * 1500 && other.segments.length < 50 && other.id !== player.id) return;

        for (let idx = 0; idx < other.segments.length; idx++) {
          // Self-collision: skip more segments to avoid immediate collision with neck/body
          // The buffer scales with player size to prevent "dying of nothing"
          const selfCollisionBuffer = 15 + Math.floor(playerRadius / 2);
          if (other.id === player.id && idx < selfCollisionBuffer) continue;

          const seg = other.segments[idx];
          const dx = newHead.x - seg.x;
          const dy = newHead.y - seg.y;
          const distSq = dx * dx + dy * dy;
          
          // Slightly tighter collision for self to prevent accidental deaths
          const finalCollisionDistSq = other.id === player.id ? collisionDistSq * 0.7 : collisionDistSq;

          if (distSq < finalCollisionDistSq) {
            player.segments.forEach((s, sIdx) => {
              if (sIdx % 2 === 0) {
                spawnFood(s.x, s.y, player.color, 10, io);
              }
            });
            
            if (!player.isBot) {
              io.to(player.id).emit("game_over");
            }
            delete players[player.id];
            break;
          }
        }
      });
    });

    io.emit("game_state", {
      players: Object.values(players),
    });
  }, 1000 / 60);

  // Initialize food
  for (let i = 0; i < 500; i++) {
    spawnFood();
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

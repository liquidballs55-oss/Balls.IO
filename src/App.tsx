import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, User, Play, RefreshCw } from 'lucide-react';

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

interface GameState {
  players: Player[];
  foods: Food[];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [meteors, setMeteors] = useState<Meteor[]>([]);
  const [isMeteorStrike, setIsMeteorStrike] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [worldSize, setWorldSize] = useState(2000);
  const [isJoined, setIsJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [playerColor, setPlayerColor] = useState(`hsl(${Math.random() * 360}, 80%, 50%)`);
  const [isGameOver, setIsGameOver] = useState(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [isBoosting, setIsBoosting] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('init', ({ id, worldSize, foods: initialFoods }) => {
      setMyId(id);
      setWorldSize(worldSize);
      setFoods(initialFoods || []);
    });

    socket.on('food_spawned', (food: Food) => {
      setFoods(prev => [...prev, food]);
    });

    socket.on('food_eaten', (foodId: string) => {
      setFoods(prev => prev.filter(f => f.id !== foodId));
    });

    socket.on('meteor_warning', (newMeteors: Meteor[]) => {
      setMeteors(newMeteors);
      setIsMeteorStrike(false);
    });

    socket.on('meteor_strike', () => {
      setIsMeteorStrike(true);
      setTimeout(() => {
        setMeteors([]);
        setIsMeteorStrike(false);
      }, 1500);
    });

    socket.on('game_state', (state: GameState) => {
      setGameState(state);
    });

    socket.on('game_over', () => {
      setIsGameOver(true);
      setIsJoined(false);
      setIsBoosting(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isJoined && !isBoosting) {
        setIsBoosting(true);
        socketRef.current?.emit('update_boost', true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isJoined) {
        setIsBoosting(false);
        socketRef.current?.emit('update_boost', false);
      }
    };
    const handleMouseDown = () => {
      if (isJoined && !isBoosting) {
        setIsBoosting(true);
        socketRef.current?.emit('update_boost', true);
      }
    };
    const handleMouseUp = () => {
      if (isJoined) {
        setIsBoosting(false);
        socketRef.current?.emit('update_boost', false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isJoined, isBoosting]);

  useEffect(() => {
    if (!canvasRef.current || !gameState) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false }); // Optimization: disable alpha for main canvas
    if (!ctx) return;

    const me = gameState.players.find(p => p.id === myId);
    const camera = me ? { x: me.segments[0].x, y: me.segments[0].y } : { x: worldSize / 2, y: worldSize / 2 };

    // Clear background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);
    
    // Draw grid (Only visible part)
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    const gridSize = 100;
    const startX = Math.floor((camera.x - canvas.width / 2) / gridSize) * gridSize;
    const endX = Math.ceil((camera.x + canvas.width / 2) / gridSize) * gridSize;
    const startY = Math.floor((camera.y - canvas.height / 2) / gridSize) * gridSize;
    const endY = Math.ceil((camera.y + canvas.height / 2) / gridSize) * gridSize;

    for (let x = Math.max(0, startX); x <= Math.min(worldSize, endX); x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, Math.max(0, startY));
      ctx.lineTo(x, Math.min(worldSize, endY));
      ctx.stroke();
    }
    for (let y = Math.max(0, startY); y <= Math.min(worldSize, endY); y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(Math.max(0, startX), y);
      ctx.lineTo(Math.min(worldSize, endX), y);
      ctx.stroke();
    }

    // Draw world border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, worldSize, worldSize);

    // Draw Meteors
    meteors.forEach(m => {
      const timeToStrike = m.strikeTime - Date.now();
      const isWarning = timeToStrike > 0;
      
      if (isWarning) {
        // Warning circle
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Pulsing inner circle
        const pulse = (Math.sin(Date.now() / 100) + 1) / 2;
        ctx.fillStyle = `rgba(255, 0, 0, ${0.1 + pulse * 0.2})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.radius * (1 - timeToStrike / 3000), 0, Math.PI * 2);
        ctx.fill();
      } else if (isMeteorStrike) {
        // Strike effect
        const age = Date.now() - m.strikeTime;
        const alpha = Math.max(0, 1 - age / 1000);
        
        const gradient = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.radius);
        gradient.addColorStop(0, `rgba(255, 100, 0, ${alpha})`);
        gradient.addColorStop(0.5, `rgba(255, 50, 0, ${alpha * 0.8})`);
        gradient.addColorStop(1, `rgba(255, 0, 0, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
        ctx.fill();

        // Debris particles (simple)
        if (age < 500) {
          ctx.fillStyle = `rgba(255, 200, 0, ${alpha})`;
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2 + age / 100;
            const dist = (age / 500) * m.radius;
            ctx.beginPath();
            ctx.arc(m.x + Math.cos(angle) * dist, m.y + Math.sin(angle) * dist, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    });

    // Culling bounds
    const cullMargin = 50;
    const left = camera.x - canvas.width / 2 - cullMargin;
    const right = camera.x + canvas.width / 2 + cullMargin;
    const top = camera.y - canvas.height / 2 - cullMargin;
    const bottom = camera.y + canvas.height / 2 + cullMargin;

    // Draw food (Culled)
    foods.forEach(food => {
      if (food.x < left || food.x > right || food.y < top || food.y > bottom) return;
      
      ctx.fillStyle = food.color;
      ctx.beginPath();
      ctx.arc(food.x, food.y, 6, 0, Math.PI * 2);
      ctx.fill();
      
      // Glow effect (Only for high value food or if performance is okay)
      if (food.value > 5) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = food.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    // Draw players (Culled)
    gameState.players.forEach(player => {
      const playerRadius = 18 + Math.sqrt(player.score) * 1.5;
      
      // Skip if entire player is off screen
      // (Rough check using head position and a large margin)
      const head = player.segments[0];
      const playerMargin = playerRadius + player.segments.length * 10;
      if (head.x < left - playerMargin || head.x > right + playerMargin || 
          head.y < top - playerMargin || head.y > bottom + playerMargin) return;

      // Draw segments from tail to head
      for (let i = player.segments.length - 1; i >= 0; i--) {
        const seg = player.segments[i];
        
        // Cull individual segments
        if (seg.x < left - playerRadius || seg.x > right + playerRadius || 
            seg.y < top - playerRadius || seg.y > bottom + playerRadius) continue;

        const isHead = i === 0;
        const radius = isHead ? playerRadius : playerRadius * 0.8;
        
        ctx.fillStyle = player.color;
        
        // Boost trail effect (Expensive, only for visible segments)
        if (player.isBoosting && i % 2 === 0) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = player.color;
        }

        ctx.beginPath();
        ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (isHead) {
          // Eyes
          ctx.fillStyle = 'white';
          const eyeOffset = radius * 0.45;
          const eyeSize = radius * 0.28;
          
          ctx.beginPath();
          ctx.arc(
            seg.x + Math.cos(player.angle - 0.5) * eyeOffset,
            seg.y + Math.sin(player.angle - 0.5) * eyeOffset,
            eyeSize, 0, Math.PI * 2
          );
          ctx.fill();
          
          ctx.beginPath();
          ctx.arc(
            seg.x + Math.cos(player.angle + 0.5) * eyeOffset,
            seg.y + Math.sin(player.angle + 0.5) * eyeOffset,
            eyeSize, 0, Math.PI * 2
          );
          ctx.fill();

          // Pupils
          ctx.fillStyle = 'black';
          const pupilOffset = radius * 0.55;
          const pupilSize = radius * 0.11;
          ctx.beginPath();
          ctx.arc(
            seg.x + Math.cos(player.angle - 0.4) * pupilOffset,
            seg.y + Math.sin(player.angle - 0.4) * pupilOffset,
            pupilSize, 0, Math.PI * 2
          );
          ctx.fill();
          ctx.beginPath();
          ctx.arc(
            seg.x + Math.cos(player.angle + 0.4) * pupilOffset,
            seg.y + Math.sin(player.angle + 0.4) * pupilOffset,
            pupilSize, 0, Math.PI * 2
          );
          ctx.fill();
        }
      }

      // Draw name
      ctx.fillStyle = 'white';
      ctx.font = `bold ${Math.max(12, playerRadius * 0.7)}px Inter`;
      ctx.textAlign = 'center';
      ctx.fillText(player.name, player.segments[0].x, player.segments[0].y - playerRadius - 15);
    });

    ctx.restore();
  }, [gameState, foods, myId, worldSize, viewport]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isJoined || !socketRef.current) return;
    
    const angle = Math.atan2(
      e.clientY - viewport.height / 2,
      e.clientX - viewport.width / 2
    );
    socketRef.current.emit('update_angle', angle);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (socketRef.current) {
      socketRef.current.emit('join', { name: playerName, color: playerColor });
      setIsJoined(true);
      setIsGameOver(false);
    }
  };

  const leaderboard = gameState?.players
    .sort((a, b) => b.score - a.score)
    .slice(0, 10) || [];

  const colors = [
    '#10b981', '#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'
  ];

  return (
    <div className="relative w-full h-screen bg-[#0a0a0a] overflow-hidden font-sans text-white select-none">
      <canvas
        ref={canvasRef}
        width={viewport.width}
        height={viewport.height}
        onMouseMove={handleMouseMove}
        className="block cursor-crosshair"
      />

      {/* UI Overlay */}
      <AnimatePresence>
        {!isJoined && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md z-50"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-zinc-900 p-10 rounded-[2.5rem] border border-white/10 shadow-2xl w-full max-w-lg"
            >
              <div className="flex flex-col items-center mb-10">
                <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(16,185,129,0.5)]">
                  <Play className="w-12 h-12 text-white fill-current" />
                </div>
                <h1 className="text-5xl font-black tracking-tighter italic">SLITHER<span className="text-emerald-500">BALLS</span></h1>
                <p className="text-zinc-400 text-sm mt-3 font-medium">The ultimate ball-chain arena.</p>
              </div>

              {isGameOver && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-8 p-5 bg-red-500/10 border border-red-500/20 rounded-2xl text-center"
                >
                  <p className="text-red-400 font-bold text-lg">Wasted!</p>
                  <p className="text-red-400/60 text-sm">You were popped by another player.</p>
                </motion.div>
              )}

              <form onSubmit={handleJoin} className="space-y-8">
                <div className="space-y-4">
                  <label className="text-xs font-bold tracking-widest uppercase text-zinc-500 ml-1">Customize Your Ball</label>
                  <div className="relative">
                    <User className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Enter your name..."
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      className="w-full bg-zinc-800/50 border border-white/5 rounded-2xl py-5 pl-14 pr-5 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-lg font-medium"
                      maxLength={15}
                    />
                  </div>
                  
                  <div className="flex flex-wrap gap-3 justify-center pt-2">
                    {colors.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setPlayerColor(c)}
                        className={`w-10 h-10 rounded-full transition-all hover:scale-110 active:scale-90 ${playerColor === c ? 'ring-4 ring-white ring-offset-4 ring-offset-zinc-900 scale-110' : 'opacity-60'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-black py-5 rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-3 text-xl tracking-tight"
                >
                  <Play className="w-6 h-6 fill-current" />
                  START GAME
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Leaderboard */}
      {isJoined && (
        <div className="absolute top-8 right-8 w-72 bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-6 pointer-events-none">
          <div className="flex items-center gap-3 mb-6 border-bottom border-white/5 pb-3">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <span className="text-[11px] font-black tracking-[0.2em] uppercase opacity-50">Top Players</span>
          </div>
          <div className="space-y-3">
            {leaderboard.map((player, idx) => (
              <div key={player.id} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-3 truncate">
                  <span className="text-zinc-600 font-black text-[10px] w-4">{idx + 1}</span>
                  <span className={`truncate ${player.id === myId ? 'text-emerald-400 font-black' : 'text-zinc-200 font-semibold'}`}>
                    {player.name}
                  </span>
                </div>
                <span className="font-mono text-zinc-400 font-bold">{Math.floor(player.score)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Score & Status */}
      {isJoined && gameState?.players.find(p => p.id === myId) && (
        <div className="absolute bottom-8 left-8 flex flex-col gap-4 pointer-events-none">
          {meteors.length > 0 && !isMeteorStrike && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: [1, 1.1, 1], opacity: 1 }}
              transition={{ repeat: Infinity, duration: 1 }}
              className="bg-red-600 text-white px-6 py-3 rounded-2xl text-sm font-black tracking-[0.2em] uppercase shadow-[0_0_30px_rgba(220,38,38,0.5)] border border-red-400/30"
            >
              ⚠️ METEOR STRIKE INBOUND ⚠️
            </motion.div>
          )}

          <div className="flex items-end gap-4">
            <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl px-8 py-5">
              <div className="text-[10px] font-black tracking-[0.2em] uppercase opacity-50 mb-1">Current Score</div>
              <div className="text-4xl font-black text-emerald-400 tracking-tighter">
                {Math.floor(gameState.players.find(p => p.id === myId)?.score || 0)}
              </div>
            </div>
            
            {isBoosting && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-emerald-500 text-white px-4 py-2 rounded-full text-[10px] font-black tracking-widest uppercase mb-2 shadow-lg shadow-emerald-500/40"
              >
                Boosting
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* Mini Map */}
      {isJoined && (
        <div className="absolute bottom-8 right-8 w-48 h-48 bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden pointer-events-none">
          <div className="relative w-full h-full">
            {/* World Border */}
            <div className="absolute inset-0 border border-white/5" />
            
            {/* Other Players */}
            {gameState?.players.map(player => {
              const isMe = player.id === myId;
              if (isMe) return null;
              return (
                <div
                  key={player.id}
                  className="absolute rounded-full"
                  style={{
                    left: `${(player.segments[0].x / worldSize) * 100}%`,
                    top: `${(player.segments[0].y / worldSize) * 100}%`,
                    width: `${Math.max(2, 2 + Math.sqrt(player.score) * 0.5)}px`,
                    height: `${Math.max(2, 2 + Math.sqrt(player.score) * 0.5)}px`,
                    backgroundColor: player.color,
                    transform: 'translate(-50%, -50%)',
                    opacity: 0.8
                  }}
                />
              );
            })}

            {/* Me */}
            {gameState?.players.find(p => p.id === myId) && (
              <motion.div
                animate={{ scale: [1, 1.5, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="absolute w-2 h-2 bg-white rounded-full shadow-[0_0_10px_white] z-10"
                style={{
                  left: `${((gameState.players.find(p => p.id === myId)?.segments[0].x || 0) / worldSize) * 100}%`,
                  top: `${((gameState.players.find(p => p.id === myId)?.segments[0].y || 0) / worldSize) * 100}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      {isJoined && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 text-zinc-500 text-[10px] font-bold tracking-widest uppercase pointer-events-none bg-black/40 backdrop-blur-md px-6 py-3 rounded-full border border-white/5">
          <div className="flex items-center gap-2">
            <span className="bg-zinc-800 px-2 py-1 rounded border border-white/5">Mouse</span>
            <span>to steer</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-zinc-800 px-2 py-1 rounded border border-white/5">Space / Click</span>
            <span>to boost</span>
          </div>
        </div>
      )}
    </div>
  );
}

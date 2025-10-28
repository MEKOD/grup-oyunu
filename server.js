// server.js - STABİLİTE GÜNCELLEMESİ (TOKEN SİSTEMİ) - TEMİZ VERSİYON

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let tasks = [];
const rooms = {};

try {
    tasks = JSON.parse(await readFile('tasks.json', 'utf-8'));
} catch (error) {
    console.error('tasks.json okunamadı!', error); process.exit(1);
}

io.on('connection', (socket) => {
    socket.on('reconnectWithToken', ({ token }) => {
        if (!token) return;
        let foundRoomId = null;
        let foundPlayer = null;
        for (const roomId in rooms) {
            const player = rooms[roomId].players.find(p => p.token === token);
            if (player) {
                foundPlayer = player;
                foundRoomId = roomId;
                break;
            }
        }
        if (foundPlayer) {
            foundPlayer.id = socket.id;
            socket.join(foundRoomId);
            socket.emit('reconnectSuccess', rooms[foundRoomId]);
            io.to(foundRoomId).emit('updatePlayerList', rooms[foundRoomId].players);
        }
    });

    const createAndJoin = (isHost, name, roomId = null) => {
        if (!roomId) {
            roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
        }
        if (isHost) {
            rooms[roomId] = { id: roomId, players: [], hostId: socket.id, gameState: 'lobby', usedTaskIds: [], currentPlayerIndex: 0, round: 0, currentTask: null };
        }
        const room = rooms[roomId];
        if (!room) return socket.emit('error', { message: 'Oda bulunamadı.' });
        if (room.gameState !== 'lobby' && !isHost) return socket.emit('error', { message: 'Oyun başlamış.' });
        const playerToken = crypto.randomBytes(16).toString('hex');
        const newPlayer = { id: socket.id, name, score: 0, token: playerToken };
        room.players.push(newPlayer);
        socket.join(roomId);
        socket.emit('sessionCreated', { token: playerToken, roomId, players: room.players });
        if (!isHost) {
            io.to(roomId).emit('updatePlayerList', room.players);
        }
    };

    socket.on('createRoom', ({ name }) => createAndJoin(true, name));
    socket.on('joinRoom', ({ roomId, name }) => createAndJoin(false, name, roomId));
    
    // Diğer tüm olaylar aynı kalıyor...
    socket.on('startGame', ({ roomId }) => { const room = rooms[roomId]; if (!room || room.hostId !== socket.id) return; if (room.players.length < 2) return; room.gameState = 'in-progress'; startTurn(roomId); });
    socket.on('passTask', ({ roomId }) => { const room = rooms[roomId]; if(!room) return; const currentPlayer = room.players[room.currentPlayerIndex]; if (socket.id !== currentPlayer.id) return; io.to(roomId).emit('turnResult', { message: `${currentPlayer.name} bu turu pas geçti.`, scores: room.players.map(p => ({ name: p.name, score: p.score })) }); setTimeout(() => startTurn(roomId), 3000); });
    socket.on('submitVote', ({ roomId, vote }) => { const room = rooms[roomId]; if (!room || !room.votes) return; if (room.votes.find(v => v.voterId === socket.id)) return; room.votes.push({ voterId: socket.id, vote }); const requiredVotes = room.players.length - 1; if (room.votes.length >= requiredVotes) { processVotes(roomId); } });
    socket.on('disconnect', () => { const roomId = Object.keys(rooms).find(key => rooms[key].players.some(p => p.id === socket.id)); if (!roomId) return; const room = rooms[roomId]; const disconnectedPlayerIndex = room.players.findIndex(p => p.id === socket.id); if (disconnectedPlayerIndex === -1) return; const wasHost = room.hostId === socket.id; room.players.splice(disconnectedPlayerIndex, 1); if (room.players.length === 0) { delete rooms[roomId]; return; } if (wasHost && room.players.length > 0) { room.hostId = room.players[0].id; } io.to(roomId).emit('updatePlayerList', room.players); if (room.gameState === 'in-progress' && room.players.length < 2) { endGame(roomId, "Yeterli oyuncu kalmadığı için oyun bitti."); } });
});
function startTurn(roomId) {const room = rooms[roomId]; if (!room) return; room.currentPlayerIndex = room.round % room.players.length; const totalRounds = room.players.length * 5; if (room.round >= totalRounds) { endGame(roomId, "Tüm turlar tamamlandı!"); return; } room.round++; const currentPlayer = room.players[room.currentPlayerIndex]; let availableTasks = tasks.filter(t => !room.usedTaskIds.includes(t.id)); if (availableTasks.length === 0) { room.usedTaskIds = []; availableTasks = tasks; } const task = availableTasks[Math.floor(Math.random() * availableTasks.length)]; room.usedTaskIds.push(task.id); room.currentTask = task; room.votes = []; io.to(roomId).emit('newTurn', { player: { name: currentPlayer.name, id: currentPlayer.id }, task: room.currentTask });}
function processVotes(roomId) {const room = rooms[roomId]; if (!room) return; const currentPlayer = room.players[room.currentPlayerIndex]; const yapildiVotes = room.votes.filter(v => v.vote === 'yapildi').length; const yapilmadiVotes = room.votes.filter(v => v.vote === 'yapilmadi').length; let message = ''; if (yapildiVotes >= yapilmadiVotes) { currentPlayer.score += 2; message = `${currentPlayer.name} görevi başardı ve 2 puan kazandı!`; } else { currentPlayer.score -= 1; message = `${currentPlayer.name} ikna edemedi ve 1 puan kaybetti!`; } io.to(roomId).emit('turnResult', { message, scores: room.players.map(p => ({ name: p.name, score: p.score })) }); setTimeout(() => startTurn(roomId), 4000);}
function endGame(roomId, reason) {const room = rooms[roomId]; if (!room) return; room.gameState = 'finished'; const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score); const lastPlayer = sortedPlayers[sortedPlayers.length - 1]; const penalties = ["Bir sonraki içecekleri ısmarlar.", "Grubun bir sonraki Instagram hikayesini o paylaşır.", "En sevdiği şarkıyı açıp dans eder."]; const penalty = penalties[Math.floor(Math.random() * penalties.length)]; io.to(roomId).emit('gameEnd', { reason, scores: sortedPlayers, lastPlayer: { name: lastPlayer.name, penalty } }); setTimeout(() => { delete rooms[roomId]; }, 300000);}
server.listen(PORT, () => console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor...`));
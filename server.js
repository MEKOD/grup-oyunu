// server.js - "MOLA HAKKI" (GRACE PERIOD) GÜNCELLEMESİ

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
    console.error('tasks.json okunamadı!', error);
    process.exit(1);
}

io.on('connection', (socket) => {

    socket.on('reconnectWithToken', ({ token, roomId }) => {
        if (!token || !roomId || !rooms[roomId]) return;
        
        const player = rooms[roomId].players.find(p => p.token === token);
        if (player) {
            player.id = socket.id;
            player.status = 'connected'; // Oyuncunun durumunu 'bağlı' olarak güncelle
            socket.join(roomId);
            socket.emit('reconnectSuccess', rooms[roomId]);
            io.to(roomId).emit('updatePlayerList', rooms[roomId].players.filter(p => p.status === 'connected'));
        }
    });

    const createAndJoin = (isHost, name, roomId = null) => {
        if (!isHost && !roomId) return;
        if (isHost) {
            roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
            rooms[roomId] = { id: roomId, players: [], hostId: socket.id, gameState: 'lobby', usedTaskIds: [], currentPlayerIndex: 0, round: 0, currentTask: null };
        }
        const room = rooms[roomId];
        if (!room) return socket.emit('error', { message: 'Oda bulunamadı.' });
        if (room.gameState !== 'lobby') return socket.emit('error', { message: 'Oyun zaten başlamış.' });
        if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
            return socket.emit('error', { message: `"${name}" adında bir oyuncu zaten odada.` });
        }
        const playerToken = crypto.randomBytes(16).toString('hex');
        const newPlayer = { id: socket.id, name, score: 0, token: playerToken, status: 'connected' }; // <-- Yeni 'status' alanı eklendi
        room.players.push(newPlayer);
        socket.join(roomId);
        socket.emit('sessionCreated', { token: playerToken, roomId, players: room.players });
        if (!isHost) {
            io.to(roomId).emit('updatePlayerList', room.players.filter(p => p.status === 'connected'));
        }
    };

    socket.on('createRoom', ({ name }) => createAndJoin(true, name));
    socket.on('joinRoom', ({ roomId, name }) => createAndJoin(false, name, roomId));

    socket.on('startGame', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id || room.players.length < 2) return;
        room.gameState = 'in-progress';
        startTurn(roomId);
    });

    socket.on('passTask', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (socket.id !== currentPlayer.id) return;

        io.to(roomId).emit('turnResult', {
            message: `${currentPlayer.name} bu turu pas geçti.`,
            scores: room.players.map(p => ({ name: p.name, score: p.score }))
        });
        setTimeout(() => startTurn(roomId), 4000);
    });

    socket.on('submitVote', ({ roomId, vote }) => {
        const room = rooms[roomId];
        if (!room || !room.votes || room.votes.find(v => v.voterId === socket.id)) return;

        room.votes.push({ voterId: socket.id, vote });
        const activePlayers = room.players.filter(p => p.status === 'connected');
        const requiredVotes = activePlayers.length - 1;

        if (room.votes.length >= requiredVotes) {
            processVotes(roomId);
        }
    });

    // --- DISCONNECT MANTIĞI YENİLENDİ ---
    socket.on('disconnect', () => {
        let roomId = null;
        let player = null;
        for (const id in rooms) {
            const p = rooms[id].players.find(p => p.id === socket.id);
            if (p) {
                roomId = id;
                player = p;
                break;
            }
        }

        if (!roomId || !player) return;

        player.status = 'disconnected';
        io.to(roomId).emit('updatePlayerList', rooms[roomId].players.filter(p => p.status === 'connected'));

        setTimeout(() => {
            if (player.status === 'disconnected') {
                const room = rooms[roomId];
                if (!room) return;
                
                room.players = room.players.filter(p => p.token !== player.token);

                if (room.players.length === 0) {
                    delete rooms[roomId];
                    return;
                }
                
                if (room.hostId === player.id) {
                    room.hostId = room.players.filter(p => p.status === 'connected')[0].id;
                }
                
                io.to(roomId).emit('updatePlayerList', room.players.filter(p => p.status === 'connected'));
                
                const activePlayersCount = room.players.filter(p => p.status === 'connected').length;
                if (room.gameState === 'in-progress' && activePlayersCount < 2) {
                    endGame(roomId, "Yeterli oyuncu kalmadı.");
                }
            }
        }, 60000); // 60 Saniye Mola Hakkı
    });
});

function startTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    
    const activePlayers = room.players.filter(p => p.status === 'connected');
    if (activePlayers.length < 1) return;

    room.currentPlayerIndex = room.round % activePlayers.length;
    const totalRounds = activePlayers.length * 5;

    if (room.round >= totalRounds) {
        endGame(roomId, "Tüm turlar tamamlandı!");
        return;
    }

    room.round++;
    const currentPlayer = activePlayers[room.currentPlayerIndex];
    
    let availableTasks = tasks.filter(t => !room.usedTaskIds.includes(t.id));
    if (availableTasks.length === 0) {
        room.usedTaskIds = [];
        availableTasks = tasks;
    }

    const task = availableTasks[Math.floor(Math.random() * availableTasks.length)];
    room.usedTaskIds.push(task.id);
    room.currentTask = task;
    room.votes = [];

    io.to(roomId).emit('newTurn', {
        player: { name: currentPlayer.name, id: currentPlayer.id },
        task: room.currentTask
    });
}

function processVotes(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    const currentPlayer = room.players.find(p => p.id === room.currentTask.playerId); // Gerçek oyuncuyu bul
    const yapildiVotes = room.votes.filter(v => v.vote === 'yapildi').length;
    const yapilmadiVotes = room.votes.filter(v => v.vote === 'yapilmadi').length;

    let message = '';
    if (yapildiVotes >= yapilmadiVotes) {
        currentPlayer.score += 2;
        message = `${currentPlayer.name} görevi başardı!`;
    } else {
        currentPlayer.score -= 1;
        message = `${currentPlayer.name} ikna edemedi!`;
    }

    io.to(roomId).emit('turnResult', {
        message,
        scores: room.players.map(p => ({ name: p.name, score: p.score }))
    });
    setTimeout(() => startTurn(roomId), 4000);
}

function endGame(roomId, reason) {
    const room = rooms[roomId];
    if (!room) return;
    room.gameState = 'finished';
    const sortedPlayers = [...room.players.filter(p => p.status === 'connected')].sort((a, b) => b.score - a.score);
    if (sortedPlayers.length === 0) return;
    const lastPlayer = sortedPlayers[sortedPlayers.length - 1];
    const penalties = ["Bir sonraki içecekleri ısmarlar.", "Grubun bir sonraki Instagram hikayesini o paylaşır.", "En sevdiği şarkıyı açıp dans eder."];
    const penalty = penalties[Math.floor(Math.random() * penalties.length)];

    io.to(roomId).emit('gameEnd', {
        scores: sortedPlayers,
        lastPlayer: { name: lastPlayer.name, penalty }
    });
    setTimeout(() => { delete rooms[roomId]; }, 300000);
}

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor...`);
});
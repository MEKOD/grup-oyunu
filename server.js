// server.js - CORS DÜZELTMESİ EKLENDİ

// 1. Gerekli Modüllerin İçeri Aktarılması
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. Sunucu Kurulumu
const app = express();
const server = http.createServer(app);

// --- BU BÖLÜM DEĞİŞTİ: Socket.io Kurulumuna CORS Ayarı Eklendi ---
const io = new Server(server, {
  cors: {
    origin: "*", // Herhangi bir kaynaktan gelen bağlantıya izin ver
    methods: ["GET", "POST"]
  }
});
// --- DEĞİŞİKLİK SONU ---

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

// 3. Oyun Veri Yapıları ve Başlangıç
let tasks = [];
const rooms = {};

try {
    const tasksData = await readFile('tasks.json', 'utf-8');
    tasks = JSON.parse(tasksData);
    console.log(`${tasks.length} görev başarıyla yüklendi.`);
} catch (error) {
    console.error('tasks.json dosyası okunamadı!', error);
    process.exit(1);
}

// 4. Ana Socket.io Bağlantı Mantığı (Bu kısım aynı kalıyor)
io.on('connection', (socket) => {
    console.log(`[BAĞLANTI BAŞARILI] Kullanıcı: ${socket.id}`);

    socket.on('createRoom', ({ name }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        socket.join(roomId);

        rooms[roomId] = {
            id: roomId,
            players: [{ id: socket.id, name, score: 0 }],
            hostId: socket.id,
            gameState: 'lobby',
            usedTaskIds: [],
            currentPlayerIndex: 0,
            round: 0
        };
        console.log(`[ODA KURULDU] Oda: ${roomId}, Kurucu: ${name}`);
        socket.emit('roomCreated', { roomId, players: rooms[roomId].players });
    });

    socket.on('joinRoom', ({ roomId, name }) => {
        console.log(`[KATILMA İSTEĞİ] Oda: '${roomId}', İsim: '${name}'`);
        if (!rooms[roomId]) {
            return socket.emit('error', { message: 'Oda bulunamadı.' });
        }
        if (rooms[roomId].gameState !== 'lobby') {
            return socket.emit('error', { message: 'Oyun zaten başlamış.' });
        }

        socket.join(roomId);
        const newPlayer = { id: socket.id, name, score: 0 };
        rooms[roomId].players.push(newPlayer);
        
        console.log(`[KATILMA BAŞARILI] '${name}' oyuncusu '${roomId}' odasına katıldı. Oyuncu sayısı: ${rooms[roomId].players.length}`);
        
        socket.emit('joinSuccess', { roomId, players: rooms[roomId].players });
        io.to(roomId).emit('updatePlayerList', rooms[roomId].players);
    });

    socket.on('startGame', ({ roomId }) => {
        const room = rooms[roomId];
        console.log(`[OYUN BAŞLATMA İSTEĞİ] Oyuncu sayısı: ${room ? room.players.length : 'Oda yok'}`);
        if (!room || room.hostId !== socket.id) return;

        if (room.players.length < 2) {
            console.warn('[OYUN BAŞLATILAMADI] Yeterli oyuncu yok.');
            return;
        }

        room.gameState = 'in-progress';
        console.log(`[OYUN BAŞLADI] Oda: '${roomId}'`);
        startTurn(roomId);
    });
    
    // Diğer tüm kodlar (passTask, submitVote, disconnect vb.) aynı kalabilir.
    socket.on('passTask', ({ roomId }) => {
        const room = rooms[roomId];
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (socket.id !== currentPlayer.id) return;
        io.to(roomId).emit('turnResult', {
            message: `${currentPlayer.name} bu turu pas geçti.`,
            scores: room.players.map(p => ({ name: p.name, score: p.score }))
        });
        setTimeout(() => startTurn(roomId), 3000);
    });

    socket.on('submitVote', ({ roomId, vote }) => {
        const room = rooms[roomId];
        if (!room || !room.votes) return;
        if (room.votes.find(v => v.voterId === socket.id)) return;
        room.votes.push({ voterId: socket.id, vote });
        const requiredVotes = room.players.length - 1;
        if (room.votes.length >= requiredVotes) {
            processVotes(roomId);
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`[BAĞLANTI KESİLDİ] Kullanıcı: ${socket.id}`);
        const roomId = Object.keys(rooms).find(key => rooms[key].players.some(p => p.id === socket.id));
        if (!roomId) return;
        const room = rooms[roomId];
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
            delete rooms[roomId];
            return;
        }
        if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
            io.to(roomId).emit('newHost', { hostId: room.hostId, hostName: room.players[0].name });
        }
        io.to(roomId).emit('updatePlayerList', room.players);
        if (room.gameState === 'in-progress' && room.players.length < 2) {
            endGame(roomId, "Yeterli oyuncu kalmadığı için oyun bitti.");
        }
    });
});

// Geri kalan fonksiyonlar (startTurn, processVotes, endGame) ve server.listen aynı.
function startTurn(roomId) {const room = rooms[roomId]; if (!room) return; const totalRounds = room.players.length * 3; if (room.round >= totalRounds) { endGame(roomId, "Tüm turlar tamamlandı!"); return; } room.round++; room.currentPlayerIndex = (room.round - 1) % room.players.length; const currentPlayer = room.players[room.currentPlayerIndex]; let availableTasks = tasks.filter(t => !room.usedTaskIds.includes(t.id)); if (availableTasks.length === 0) { room.usedTaskIds = []; availableTasks = tasks; } const task = availableTasks[Math.floor(Math.random() * availableTasks.length)]; room.usedTaskIds.push(task.id); room.currentTask = task; room.votes = []; io.to(roomId).emit('newTurn', { player: { name: currentPlayer.name, id: currentPlayer.id }, task: room.currentTask, round: room.round, totalRounds: totalRounds });}
function processVotes(roomId) {const room = rooms[roomId]; if (!room) return; const currentPlayer = room.players[room.currentPlayerIndex]; const yapildiVotes = room.votes.filter(v => v.vote === 'yapildi').length; const yapilmadiVotes = room.votes.filter(v => v.vote === 'yapilmadi').length; let message = ''; if (yapildiVotes >= yapilmadiVotes) { currentPlayer.score += 2; message = `${currentPlayer.name} görevi başardı ve 2 puan kazandı!`; } else { currentPlayer.score -= 1; message = `${currentPlayer.name} ikna edemedi ve 1 puan kaybetti!`; } io.to(roomId).emit('turnResult', { message, scores: room.players.map(p => ({ name: p.name, score: p.score })) }); setTimeout(() => startTurn(roomId), 4000);}
function endGame(roomId, reason) {const room = rooms[roomId]; if (!room) return; room.gameState = 'finished'; const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score); const lastPlayer = sortedPlayers[sortedPlayers.length - 1]; const penalties = ["Bir sonraki içecekleri ısmarlar.", "Grubun bir sonraki Instagram hikayesini o paylaşır.", "En sevdiği şarkıyı açıp dans eder."]; const penalty = penalties[Math.floor(Math.random() * penalties.length)]; io.to(roomId).emit('gameEnd', { reason, scores: sortedPlayers, lastPlayer: { name: lastPlayer.name, penalty } }); setTimeout(() => { delete rooms[roomId]; }, 300000);}

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor...`);
});
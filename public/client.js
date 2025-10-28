// client.js

document.addEventListener('DOMContentLoaded', () => {
    const socket = io({
        transports: ['websocket']
    });

    const screens = {
        login: document.getElementById('login-screen'),
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen'),
        end: document.getElementById('end-screen'),
    };
    const joinModal = document.getElementById('join-modal');

    const nameInput = document.getElementById('name-input');
    const createRoomBtn = document.getElementById('create-room-btn');
    const showJoinBtn = document.getElementById('show-join-btn');
    const loginError = document.getElementById('login-error');
    const roomInput = document.getElementById('room-input');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const joinError = document.getElementById('join-error');
    const lobbyRoomCode = document.getElementById('lobby-room-code');
    const lobbyPlayerList = document.getElementById('lobby-player-list');
    const startGameBtn = document.getElementById('start-game-btn');
    const playerAvatarBar = document.getElementById('player-avatars');
    const taskArea = document.getElementById('task-area');
    const scoreboard = document.getElementById('scoreboard');
    const endMessage = document.getElementById('end-message');
    const endPenalty = document.getElementById('end-penalty');

    let gameState = { myId: null, roomId: null, isHost: false, players: [], hostId: null };
    const playerAvatars = {};
    const EMOJIS = ['🦊', '🐸', '🦄', '🐲', '👽', '🤖', '👑', '😎', '👻', '🐙'];

    function showScreen(screenName) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        if (screens[screenName]) {
            screens[screenName].classList.add('active');
        }
    }

    function updatePlayerDisplays(players, currentPlayerId = null, hostId = null) {
        // Host ID'yi güncelle
        if (hostId) {
            gameState.hostId = hostId;
        }
        
        playerAvatarBar.innerHTML = '';
        players.forEach(p => {
            if (!playerAvatars[p.id]) {
                const availableEmojis = EMOJIS.filter(e => !Object.values(playerAvatars).includes(e));
                playerAvatars[p.id] = availableEmojis.length > 0 ? availableEmojis[Math.floor(Math.random() * availableEmojis.length)] : '❓';
            }
            const avatarEl = document.createElement('div');
            avatarEl.classList.add('player-avatar');
            avatarEl.textContent = playerAvatars[p.id];
            if (p.id === currentPlayerId) avatarEl.classList.add('active');
            playerAvatarBar.appendChild(avatarEl);
        });
        
        lobbyPlayerList.innerHTML = '';
        players.forEach(p => {
             const avatarEl = document.createElement('div');
             avatarEl.textContent = playerAvatars[p.id];
             lobbyPlayerList.appendChild(avatarEl);
        });

        const sortedPlayers = [...players].sort((a,b) => b.score - a.score);
        scoreboard.innerHTML = '';
        sortedPlayers.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${playerAvatars[p.id] || '❓'} ${p.name}</span> <span class="score">${p.score}</span>`;
            scoreboard.appendChild(li);
        });
        
        // Host kontrolü - socket.id ile karşılaştır
        gameState.isHost = socket.id === gameState.hostId;
        console.log('Host kontrolü:', { myId: socket.id, hostId: gameState.hostId, isHost: gameState.isHost });
        
        if (startGameBtn) {
            startGameBtn.style.display = gameState.isHost ? 'block' : 'none';
        }
    }

    if (createRoomBtn) {
        createRoomBtn.addEventListener('click', () => {
            const name = nameInput.value.trim();
            if (!name) { loginError.textContent = 'Takma ad girmek zorunlu!'; return; }
            createRoomBtn.disabled = true;
            loginError.textContent = '';
            socket.emit('createRoom', { name });
        });
    }

    if (showJoinBtn) {
        showJoinBtn.addEventListener('click', () => {
            const name = nameInput.value.trim();
            if (!name) { loginError.textContent = 'Önce takma adını girmelisin!'; return; }
            loginError.textContent = '';
            joinModal.classList.add('active');
        });
    }
    
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => joinModal.classList.remove('active'));
    }
    
    if (joinRoomBtn) {
        joinRoomBtn.addEventListener('click', () => {
            const roomId = roomInput.value.trim().toUpperCase();
            const name = nameInput.value.trim();
            if (!roomId) { joinError.textContent = 'Oda kodu girmelisin!'; return; }
            joinRoomBtn.disabled = true;
            joinError.textContent = '';
            socket.emit('joinRoom', { roomId, name });
        });
    }

    if (startGameBtn) {
        startGameBtn.addEventListener('click', () => {
            console.log('Oyun başlatılıyor...');
            socket.emit('startGame', { roomId: gameState.roomId });
        });
    }

    socket.on('connect', () => {
        gameState.myId = socket.id;
        console.log('Bağlantı kuruldu:', socket.id);
        const playerToken = localStorage.getItem('playerToken');
        const roomId = localStorage.getItem('roomId');
        if (playerToken && roomId) {
            socket.emit('reconnectWithToken', { token: playerToken, roomId });
        }
    });

    socket.on('sessionCreated', ({ token, roomId, players }) => {
        console.log('Session oluşturuldu:', { token, roomId, players });
        localStorage.setItem('playerToken', token);
        localStorage.setItem('roomId', roomId);
        gameState.roomId = roomId;
        gameState.players = players;
        
        // İlk oyuncu her zaman host'tur
        gameState.hostId = players[0].id;
        
        if(lobbyRoomCode) lobbyRoomCode.textContent = roomId;
        updatePlayerDisplays(players, null, gameState.hostId);
        showScreen('lobby');
        joinModal.classList.remove('active');
        createRoomBtn.disabled = false;
        joinRoomBtn.disabled = false;
    });
    
    socket.on('reconnectSuccess', (roomState) => {
        console.log('Yeniden bağlanıldı:', roomState);
        gameState.roomId = roomState.id;
        gameState.players = roomState.players;
        gameState.hostId = roomState.hostId;
        
        if (roomState.gameState === 'lobby') {
            if(lobbyRoomCode) lobbyRoomCode.textContent = roomState.id;
            updatePlayerDisplays(roomState.players, null, roomState.hostId);
            showScreen('lobby');
        } else if (roomState.gameState === 'in-progress') {
            const activePlayers = roomState.players.filter(p => p.status === 'connected');
            const currentPlayer = activePlayers[roomState.currentPlayerIndex];
            handleNewTurn(currentPlayer, roomState.currentTask);
        }
    });

    socket.on('updatePlayerList', (players) => {
        console.log('Oyuncu listesi güncellendi:', players);
        gameState.players = players;
        updatePlayerDisplays(players, null, gameState.hostId);
    });

    function handleNewTurn(player, task) {
        if (!task || !player) return;
        console.log('Yeni tur:', { player, task });
        updatePlayerDisplays(gameState.players, player.id, gameState.hostId);
        let content = `<div class="task-card"><p class="task-type">${task.type.toUpperCase()}</p><p class="task-text">${task.text}</p></div>`;
        if (player.id === socket.id) {
            content += `<button id="pass-task-btn" class="btn btn-secondary">Pas Geç</button>`;
        } else {
            content += `<p class="subtitle">Görevi yapıyor mu?</p><div class="vote-btn-group"><button class="btn btn-success vote-btn" data-vote="yapildi">✅ İkna Oldum</button><button class="btn btn-fail vote-btn" data-vote="yapilmadi">❌ İkna Olmadım</button></div>`;
        }
        taskArea.innerHTML = content;
        showScreen('game');
        if (player.id === socket.id) {
            const passBtn = document.getElementById('pass-task-btn');
            if(passBtn) passBtn.addEventListener('click', () => {
                passBtn.disabled = true;
                socket.emit('passTask', { roomId: gameState.roomId });
            });
        } else {
            document.querySelectorAll('.vote-btn').forEach(btn => btn.addEventListener('click', (e) => {
                console.log('Oy gönderiliyor:', e.target.dataset.vote);
                socket.emit('submitVote', { roomId: gameState.roomId, vote: e.target.dataset.vote });
                const btnGroup = taskArea.querySelector('.vote-btn-group');
                if(btnGroup) btnGroup.innerHTML = `<p class="subtitle">Oyun alındı, bekleniyor...</p>`;
            }));
        }
    }

    socket.on('newTurn', ({ player, task }) => handleNewTurn(player, task));

    socket.on('turnResult', ({ message, scores }) => {
        console.log('Tur sonucu:', { message, scores });
        scores.forEach(s => {
           const player = gameState.players.find(p => p.name === s.name);
           if (player) player.score = s.score;
        });
        updatePlayerDisplays(gameState.players, null, gameState.hostId);
        taskArea.innerHTML = `<p class="subtitle">${message}</p>`;
    });

    socket.on('gameEnd', ({ scores, lastPlayer }) => {
        console.log('Oyun bitti:', { scores, lastPlayer });
        endMessage.textContent = `${lastPlayer.name} kaybetti!`;
        endPenalty.textContent = `Şimdi şunu yapmak zorunda: ${lastPlayer.penalty}`;
        localStorage.removeItem('playerToken');
        localStorage.removeItem('roomId');
        showScreen('end');
    });

    socket.on('error', ({ message }) => {
        console.error('Hata:', message);
        const errorEl = joinModal.classList.contains('active') ? joinError : loginError;
        errorEl.textContent = message;
        createRoomBtn.disabled = false;
        joinRoomBtn.disabled = false;
        setTimeout(() => { errorEl.textContent = '' }, 3000);
    });
});
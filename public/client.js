// client.js - STABİLİTE GÜNCELLEMESİ (TOKEN SİSTEMİ)

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    // ... (Tüm DOM elemanları ve sabitler aynı)
    const screens = { login: document.getElementById('login-screen'), lobby: document.getElementById('lobby-screen'), game: document.getElementById('game-screen'), end: document.getElementById('end-screen') };
    const joinModal = document.getElementById('join-modal');
    const nameInput = document.getElementById('name-input');
    const createRoomBtn = document.getElementById('create-room-btn');
    const showJoinBtn = document.getElementById('show-join-btn');
    const loginError = document.getElementById('login-error');
    const roomInput = document.getElementById('room-input');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const joinError = document.getElementById('join-error');
    const lobbyPlayerList = document.getElementById('lobby-player-list');
    const startGameBtn = document.getElementById('start-game-btn');
    const playerAvatarBar = document.getElementById('player-avatars');
    const taskArea = document.getElementById('task-area');
    const scoreboard = document.getElementById('scoreboard');
    const endMessage = document.getElementById('end-message');
    const endPenalty = document.getElementById('end-penalty');
    const joinLinkInput = document.getElementById('join-link-input');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const qrCanvas = document.getElementById('qr-code');

    let gameState = { myId: null, roomId: null, isHost: false, players: [] };
    const playerAvatars = {};
    const EMOJIS = ['🦊', '🐸', '🦄', '🐲', '👽', '🤖', '👑', '😎', '👻', '🐙'];

    // ... (showScreen ve updatePlayerDisplays fonksiyonları aynı)
    function showScreen(screenName) { Object.values(screens).forEach(screen => screen.classList.remove('active')); screens[screenName].classList.add('active'); }
    function updatePlayerDisplays(players, currentPlayerId = null) { const hostId = players.length > 0 ? players[0].id : null; playerAvatarBar.innerHTML = ''; players.forEach(p => { if (!playerAvatars[p.id]) { const availableEmojis = EMOJIS.filter(e => !Object.values(playerAvatars).includes(e)); playerAvatars[p.id] = availableEmojis.length > 0 ? availableEmojis[Math.floor(Math.random() * availableEmojis.length)] : '❓'; } const avatarEl = document.createElement('div'); avatarEl.classList.add('player-avatar'); avatarEl.textContent = playerAvatars[p.id]; if (p.id === currentPlayerId) avatarEl.classList.add('active'); playerAvatarBar.appendChild(avatarEl); }); lobbyPlayerList.innerHTML = ''; players.forEach(p => { const avatarEl = document.createElement('div'); avatarEl.textContent = playerAvatars[p.id]; lobbyPlayerList.appendChild(avatarEl); }); const sortedPlayers = [...players].sort((a, b) => b.score - a.score); scoreboard.innerHTML = ''; sortedPlayers.forEach(p => { const li = document.createElement('li'); li.innerHTML = `<span>${playerAvatars[p.id] || '❓'} ${p.name}</span> <span class="score">${p.score}</span>`; scoreboard.appendChild(li); }); gameState.isHost = socket.id === hostId; if (startGameBtn) startGameBtn.style.display = gameState.isHost ? 'block' : 'none'; }

    // --- Olay Dinleyicileri aynı ---
    if (copyLinkBtn) { copyLinkBtn.addEventListener('click', () => { joinLinkInput.select(); document.execCommand('copy'); copyLinkBtn.textContent = 'Kopyalandı! ✅'; setTimeout(() => { copyLinkBtn.textContent = 'Linki Kopyala'; }, 2000); }); }
    if (createRoomBtn) { createRoomBtn.addEventListener('click', () => { const name = nameInput.value.trim(); if (!name) { loginError.textContent = 'Takma ad girmek zorunlu!'; return; } loginError.textContent = ''; socket.emit('createRoom', { name }); }); }
    if (showJoinBtn) { showJoinBtn.addEventListener('click', () => { const name = nameInput.value.trim(); if (!name) { loginError.textContent = 'Önce takma adını girmelisin!'; return; } loginError.textContent = ''; joinModal.classList.add('active'); }); }
    if (closeModalBtn) { closeModalBtn.addEventListener('click', () => joinModal.classList.remove('active')); }
    if (joinRoomBtn) { joinRoomBtn.addEventListener('click', () => { const roomId = roomInput.value.trim().toUpperCase(); if (!roomId) { joinError.textContent = 'Oda kodu girmelisin!'; return; } joinError.textContent = ''; socket.emit('joinRoom', { roomId, name: nameInput.value.trim() }); }); }
    if (startGameBtn) { startGameBtn.addEventListener('click', () => { socket.emit('startGame', { roomId: gameState.roomId }); }); }


    // --- Socket Olayları ---
    socket.on('connect', () => {
        console.log("Sunucuya bağlandı! ID:", socket.id);
        gameState.myId = socket.id;
        
        // --- KRİTİK: localStorage'dan token'ı bul ve sunucuya gönder ---
        const playerToken = localStorage.getItem('playerToken');
        if (playerToken) {
            console.log("Kaydedilmiş token bulundu, sunucuya gönderiliyor...");
            socket.emit('reconnectWithToken', { token: playerToken });
        }
    });

    // --- YENİ: Token'ı ve oda bilgilerini sakla ---
    socket.on('sessionCreated', ({ token, roomId, players }) => {
        console.log("Yeni oturum oluşturuldu, token kaydediliyor.");
        localStorage.setItem('playerToken', token);
        localStorage.setItem('roomId', roomId); // Oda kodunu da sakla
        
        gameState.roomId = roomId;
        gameState.players = players;
        
        const joinUrl = `${window.location.origin}/join/${roomId}`;
        joinLinkInput.value = joinUrl;
        if(qrCanvas) new QRious({ element: qrCanvas, value: joinUrl, size: 150, backgroundAlpha: 0, foreground: '#E1E1E1' });

        updatePlayerDisplays(players);
        showScreen('lobby');
    });
    
    // --- YENİ: Başarılı yeniden bağlanma sonrası arayüzü güncelle ---
    socket.on('reconnectSuccess', (roomState) => {
        console.log("Yeniden bağlanma başarılı, oyun durumu senkronize ediliyor.");
        gameState.roomId = roomState.id;
        gameState.players = roomState.players;

        if (roomState.gameState === 'lobby') {
            const joinUrl = `${window.location.origin}/join/${roomState.id}`;
            joinLinkInput.value = joinUrl;
            if (qrCanvas) new QRious({ element: qrCanvas, value: joinUrl, size: 150, backgroundAlpha: 0, foreground: '#E1E1E1' });
            updatePlayerDisplays(roomState.players);
            showScreen('lobby');
        } else if (roomState.gameState === 'in-progress') {
            const currentPlayer = roomState.players[roomState.currentPlayerIndex];
            handleNewTurn(currentPlayer, roomState.currentTask);
        }
    });

    socket.on('updatePlayerList', (players) => {
        gameState.players = players;
        updatePlayerDisplays(players);
    });

    function handleNewTurn(player, task) {
        if (!task) return; // Eğer görev yoksa (oyun bitmişse vs.) hata verme
        updatePlayerDisplays(gameState.players, player.id);
        let content = `<div class="task-card"><p class="task-type">${task.type.toUpperCase()}</p><p class="task-text">${task.text}</p></div>`;
        if (player.id === gameState.myId) { content += `<button id="pass-task-btn" class="btn btn-secondary">Pas Geç</button>`; } else { content += `<p class="subtitle">Görevi yapıyor mu?</p><div class="vote-btn-group"><button class="btn btn-success vote-btn" data-vote="yapildi">✅ İkna Oldum</button><button class="btn btn-fail vote-btn" data-vote="yapilmadi">❌ İkna Olmadım</button></div>`; }
        taskArea.innerHTML = content; showScreen('game');
        if (player.id === gameState.myId) { const passBtn = document.getElementById('pass-task-btn'); if(passBtn) passBtn.addEventListener('click', () => { passBtn.disabled = true; socket.emit('passTask', { roomId: gameState.roomId }); }); } else { document.querySelectorAll('.vote-btn').forEach(btn => btn.addEventListener('click', (e) => { socket.emit('submitVote', { roomId: gameState.roomId, vote: e.target.dataset.vote }); const btnGroup = taskArea.querySelector('.vote-btn-group'); if(btnGroup) btnGroup.innerHTML = `<p class="subtitle">Oyun alındı, bekleniyor...</p>`; })); }
    }

    socket.on('newTurn', ({ player, task }) => handleNewTurn(player, task));
    
    // ... (turnResult, gameEnd, error, handleDirectJoin olayları aynı)
    socket.on('turnResult', ({ message, scores }) => { scores.forEach(s => { const player = gameState.players.find(p => p.name === s.name); if (player) player.score = s.score; }); updatePlayerDisplays(gameState.players); taskArea.innerHTML = `<p class="subtitle">${message}</p>`; });
    socket.on('gameEnd', ({ scores, lastPlayer }) => { endMessage.textContent = `${lastPlayer.name} kaybetti!`; endPenalty.textContent = `Şimdi şunu yapmak zorunda: ${lastPlayer.penalty}`; localStorage.removeItem('playerToken'); localStorage.removeItem('roomId'); showScreen('end'); });
    socket.on('error', ({ message }) => { const errorEl = joinModal.classList.contains('active') ? joinError : loginError; errorEl.textContent = message; setTimeout(() => { errorEl.textContent = '' }, 3000); });
    function handleDirectJoin() { const path = window.location.pathname; const match = path.match(/\/join\/([A-Z0-9]{6})/); if (match) { const roomId = match[1]; const name = prompt("Oyuna katılmak için takma adını gir:"); if (name && name.trim()) { nameInput.value = name.trim(); socket.emit('joinRoom', { roomId, name: name.trim() }); } } }
    handleDirectJoin();
});
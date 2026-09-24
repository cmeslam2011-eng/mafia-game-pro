// ==========================================
// 1. تهيئة Firebase
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyD5WRTJU_fKnMlQ0-Z50qAF13AvDTer0oo",
    authDomain: "mafia-game-f6595.firebaseapp.com",
    databaseURL: "https://mafia-game-f6595-default-rtdb.firebaseio.com",
    projectId: "mafia-game-f6595",
    storageBucket: "mafia-game-f6595.firebasestorage.app",
    messagingSenderId: "284953296470",
    appId: "1:284953296470:web:4ab6652ca1bee5ad4a05f7"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==========================================
// 2. المتغيرات العامة
// ==========================================
let currentRoomCode = null;
let playerId = null;
let playerName = "";
let isHost = false;
let myRole = "";
let timerInterval = null;

// ==========================================
// 3. ربط الأحداث
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnCreateRoom').addEventListener('click', createRoom);
    document.getElementById('btnJoinRoom').addEventListener('click', joinRoom);
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettingsAndGoToLobby);
    document.getElementById('btnStartGame').addEventListener('click', startGame);
    document.getElementById('btnSendChat').addEventListener('click', sendChatMessage);

    document.getElementById('roleSystemSelect').addEventListener('change', (e) => {
        document.getElementById('customMafiaArea').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
});

function showScreen(screenId) {
    ['authScreen', 'settingsScreen', 'lobbyScreen', 'gameScreen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    document.getElementById(screenId).style.display = 'block';
}

// ==========================================
// 4. إنشاء وانضمام الغرفة
// ==========================================
function createRoom() {
    playerName = document.getElementById('playerNameInput').value.trim();
    if (!playerName) return alert("أدخل اسمك أولاً!");

    isHost = true;
    currentRoomCode = Math.floor(1000 + Math.random() * 9000).toString();
    playerId = db.ref().child('rooms').push().key;

    const initialData = {
        code: currentRoomCode,
        hostId: playerId,
        settings: { dayTime: 60, nightTime: 30, voteTime: 30, roleSystem: 'auto', mafiaCount: 1 },
        gameState: { phase: 'lobby', timer: 0, announcement: '' },
        players: { [playerId]: { name: playerName, role: 'citizen', alive: true } }
    };

    db.ref(`rooms/${currentRoomCode}`).set(initialData, (err) => {
        if (!err) {
            document.getElementById('displayRoomCode').innerText = currentRoomCode;
            showScreen('settingsScreen');
            listenToRoomUpdates();
        }
    });
}

function joinRoom() {
    playerName = document.getElementById('playerNameInput').value.trim();
    currentRoomCode = document.getElementById('roomCodeInput').value.trim();
    if (!playerName || !currentRoomCode) return alert("أدخل الاسم ورمز الغرفة!");

    playerId = db.ref().child('rooms').push().key;
    const roomRef = db.ref(`rooms/${currentRoomCode}`);

    roomRef.once('value', (snap) => {
        if (snap.exists()) {
            roomRef.child(`players/${playerId}`).set({ name: playerName, role: 'citizen', alive: true }, () => {
                document.getElementById('displayRoomCode').innerText = currentRoomCode;
                showScreen('lobbyScreen');
                listenToRoomUpdates();
            });
        } else {
            alert("الغرفة غير موجودة!");
        }
    });
}

function saveSettingsAndGoToLobby() {
    if (!isHost) return;

    const settings = {
        dayTime: parseInt(document.getElementById('dayTimeSelect').value),
        nightTime: parseInt(document.getElementById('nightTimeSelect').value),
        voteTime: parseInt(document.getElementById('voteTimeSelect').value),
        roleSystem: document.getElementById('roleSystemSelect').value,
        mafiaCount: parseInt(document.getElementById('mafiaSelect').value)
    };

    db.ref(`rooms/${currentRoomCode}/settings`).set(settings, () => {
        showScreen('lobbyScreen');
    });
}

// ==========================================
// 5. نظام الأدوار المتخصص
// ==========================================
function generateRoles(count, settings) {
    let roles = [];

    if (settings.roleSystem === 'custom') {
        for (let i = 0; i < settings.mafiaCount; i++) {
            roles.push(i === 0 ? 'شيخ مافيا' : 'مافيا');
        }
        roles.push('طبيب');
    } else {
        if (count >= 13) {
            roles = ['شيخ مافيا', 'مافيا تسكيت', 'مافيا', 'طبيب', 'محقق', 'ولد صالح'];
        } else if (count >= 10) {
            roles = ['شيخ مافيا', 'مافيا', 'طبيب', 'محقق', 'ولد صالح'];
        } else if (count >= 8) {
            roles = ['شيخ مافيا', 'مافيا', 'طبيب', 'محقق'];
        } else {
            roles = ['شيخ مافيا', 'طبيب'];
        }
    }

    while (roles.length < count) roles.push('مواطن');
    return roles.sort(() => Math.random() - 0.5);
}

function startGame() {
    if (!isHost) return;

    db.ref(`rooms/${currentRoomCode}`).once('value', (snap) => {
        const room = snap.val();
        if (!room || !room.players) return;

        const playerIds = Object.keys(room.players);
        const settings = room.settings;
        const assignedRoles = generateRoles(playerIds.length, settings);

        let updates = {};
        playerIds.forEach((id, idx) => {
            updates[`rooms/${currentRoomCode}/players/${id}/role`] = assignedRoles[idx];
        });

        updates[`rooms/${currentRoomCode}/gameState`] = {
            phase: 'night',
            timer: settings.nightTime,
            announcement: '🌙 بدأ الليل.. أصحاب المهام يقومون بأدوارهم الآن'
        };

        db.ref().update(updates, () => {
            startHostTimer(settings.nightTime, 'day');
        });
    });
}

// ==========================================
// 6. إدارة المراحل وتنفيذ القرارات الليلية
// ==========================================
function startHostTimer(seconds, nextPhase) {
    if (!isHost) return;
    clearInterval(timerInterval);
    let timeLeft = seconds;

    timerInterval = setInterval(() => {
        timeLeft--;
        db.ref(`rooms/${currentRoomCode}/gameState/timer`).set(timeLeft);

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            handlePhaseTransition(nextPhase);
        }
    }, 1000);
}

function handlePhaseTransition(nextPhase) {
    db.ref(`rooms/${currentRoomCode}`).once('value', (snap) => {
        const room = snap.val();
        if (!room) return;

        const settings = room.settings;
        let announcement = '';
        let futurePhase = '';
        let phaseTime = 0;

        if (nextPhase === 'day') {
            phaseTime = settings.dayTime;
            const targetId = room.nightTarget;
            const doctorTarget = room.doctorTarget;
            const silencedTarget = room.silencedTarget;

            // تطبيق قرار التسكيت
            if (silencedTarget) {
                db.ref(`rooms/${currentRoomCode}/silencedPlayerId`).set(silencedTarget);
            } else {
                db.ref(`rooms/${currentRoomCode}/silencedPlayerId`).remove();
            }

            // تنفيذ معالجة الموت أو الإنقاذ
            if (targetId && targetId !== doctorTarget && room.players[targetId]) {
                db.ref(`rooms/${currentRoomCode}/players/${targetId}/alive`).set(false);
                announcement = `☀️ حل النهار! للأسف قُتل اللاعب (${room.players[targetId].name}) الليلة.`;
            } else if (targetId && targetId === doctorTarget) {
                announcement = `☀️ حل النهار! حاول القاتل تصفية أحد اللاعبين ولكن الطبيب نجح في إنقاذه! 🩺`;
            } else {
                announcement = `☀️ حل النهار! تمر الليلة بسلام ولم يُقتل أحد.`;
            }

            // مسح الخيارات الليلية
            db.ref(`rooms/${currentRoomCode}/nightTarget`).remove();
            db.ref(`rooms/${currentRoomCode}/doctorTarget`).remove();
            db.ref(`rooms/${currentRoomCode}/silencedTarget`).remove();

            futurePhase = 'vote';

        } else if (nextPhase === 'vote') {
            phaseTime = settings.voteTime;
            announcement = `🗳️ انتهى وقت النقاش! حان وقت التصويت لطرد المشتبه به.`;
            futurePhase = 'night';

        } else if (nextPhase === 'night') {
            phaseTime = settings.nightTime;
            db.ref(`rooms/${currentRoomCode}/silencedPlayerId`).remove(); // إلغاء التسكيت عند حلول الليل

            const votes = room.votes || {};
            const voteCounts = {};
            Object.values(votes).forEach(tId => voteCounts[tId] = (voteCounts[tId] || 0) + 1);

            let maxVotes = 0;
            let eliminatedId = null;
            Object.entries(voteCounts).forEach(([id, count]) => {
                if (count > maxVotes) { maxVotes = count; eliminatedId = id; }
            });

            if (eliminatedId && room.players[eliminatedId]) {
                db.ref(`rooms/${currentRoomCode}/players/${eliminatedId}/alive`).set(false);
                announcement = `🌙 حل الليل! تم طرد اللاعب (${room.players[eliminatedId].name}) بأغلبية الأصوات.`;
            } else {
                announcement = `🌙 حل الليل! لم يتم طرد أحد لعدم اكتمال الأصوات.`;
            }
            db.ref(`rooms/${currentRoomCode}/votes`).remove();
            futurePhase = 'day';
        }

        db.ref(`rooms/${currentRoomCode}/players`).once('value', (playersSnap) => {
            const currentPlayers = playersSnap.val() || {};
            const winnerMessage = checkGameOver(currentPlayers);

            if (winnerMessage) {
                clearInterval(timerInterval);
                db.ref(`rooms/${currentRoomCode}/gameState`).set({ phase: 'ended', timer: 0, announcement: winnerMessage });
            } else {
                db.ref(`rooms/${currentRoomCode}/gameState`).set({ phase: nextPhase, timer: phaseTime, announcement: announcement });
                startHostTimer(phaseTime, futurePhase);
            }
        });
    });
}

function checkGameOver(players) {
    let mafiaCount = 0;
    let citizenCount = 0;

    Object.values(players).forEach(p => {
        if (p.alive) {
            if (p.role.includes('مافيا')) mafiaCount++;
            else citizenCount++;
        }
    });

    if (mafiaCount === 0) return "🎉 انتصر الصالحون! تم القضاء على المافيا بالكامل.";
    if (mafiaCount >= citizenCount) return "🔪 انتصرت المافيا! أصبحت المافيا تسيطر على المدينة.";
    return null;
}

// ==========================================
// 7. الاستماع للتحديثات والمحادثة
// ==========================================
function listenToRoomUpdates() {
    db.ref(`rooms/${currentRoomCode}`).on('value', (snap) => {
        const room = snap.val();
        if (!room) return;

        document.getElementById('displayRoomCode').innerText = currentRoomCode;

        if (isHost && room.gameState.phase === 'lobby') {
            document.getElementById('btnStartGame').style.display = 'block';
        }

        const playersList = document.getElementById('playersList');
        playersList.innerHTML = '';
        if (room.players) {
            Object.values(room.players).forEach(p => {
                const li = document.createElement('li');
                li.innerText = p.name + (p.alive ? '' : ' 💀');
                playersList.appendChild(li);
            });
        }

        if (room.gameState && room.gameState.phase !== 'lobby') {
            showScreen('gameScreen');
            document.getElementById('timerDisplay').innerText = `الوقت المتبقي: ${room.gameState.timer} ثانية`;

            if (room.players && room.players[playerId]) {
                myRole = room.players[playerId].role;
                const isAlive = room.players[playerId].alive;
                document.getElementById('myRoleDisplay').innerText = `${myRole} ${isAlive ? '' : '(أنت ميت 💀)'}`;
            }

            const annoBox = document.getElementById('announcementBox');
            if (room.gameState.announcement) {
                annoBox.style.display = 'block';
                annoBox.innerText = room.gameState.announcement;
            }

            renderGameActions(room);
        }
    });

    db.ref(`rooms/${currentRoomCode}/chat`).on('child_added', (snap) => {
        const msg = snap.val();
        const chatBox = document.getElementById('chatMessages');
        if (chatBox) {
            const div = document.createElement('div');
            div.className = 'chat-msg';
            div.innerHTML = `<span>${msg.sender}:</span> ${msg.text}`;
            chatBox.appendChild(div);
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    });
}

// ==========================================
// 8. بناء أزرار الأدوار التفاعلية في الليل والنهار
// ==========================================
function renderGameActions(room) {
    const actionArea = document.getElementById('actionArea');
    const chatSection = document.getElementById('chatSection');
    actionArea.innerHTML = '';
    const phase = room.gameState.phase;
    const me = room.players ? room.players[playerId] : null;

    if (phase === 'ended') {
        document.getElementById('phaseDisplay').innerText = '🏆 نهاية اللعبة';
        chatSection.style.display = 'none';
        actionArea.innerHTML = '<h3>انتهت اللعبة!</h3>';
        return;
    }

    if (phase === 'night') {
        document.getElementById('phaseDisplay').innerText = '🌙 مرحلة الليل (المهام)';
        chatSection.style.display = 'none';

        if (me && me.alive) {
            // 1. شيخ المافيا (أو المافيا العادية إذا لم يوجد شيخ)
            if (myRole === 'شيخ مافيا' || (myRole === 'مافيا' && !Object.values(room.players).some(p => p.alive && p.role === 'شيخ مافيا'))) {
                actionArea.innerHTML = '<h4>🔪 اختر الضحية لقتلها:</h4>';
                Object.entries(room.players).forEach(([id, p]) => {
                    if (!p.role.includes('مافيا') && p.alive) {
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-secondary';
                        btn.innerText = `تصفية ${p.name}`;
                        btn.onclick = () => {
                            db.ref(`rooms/${currentRoomCode}/nightTarget`).set(id);
                            alert(`تم اختيار ${p.name} للقتل`);
                        };
                        actionArea.appendChild(btn);
                    }
                });

            // 2. مافيا التسكيت
            } else if (myRole === 'مافيا تسكيت') {
                actionArea.innerHTML = '<h4>🤐 اختر لاعباً لمنعه من الشات غداً:</h4>';
                Object.entries(room.players).forEach(([id, p]) => {
                    if (id !== playerId && p.alive) {
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-secondary';
                        btn.innerText = `تسكيت ${p.name}`;
                        btn.onclick = () => {
                            db.ref(`rooms/${currentRoomCode}/silencedTarget`).set(id);
                            alert(`تم اختيار تسكيت ${p.name}`);
                        };
                        actionArea.appendChild(btn);
                    }
                });

            // 3. الطبيب
            } else if (myRole === 'طبيب') {
                actionArea.innerHTML = '<h4>🩺 اختر لاعباً لحمايته من الموت:</h4>';
                Object.entries(room.players).forEach(([id, p]) => {
                    if (p.alive) {
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-success';
                        btn.innerText = `حماية ${p.name}`;
                        btn.onclick = () => {
                            db.ref(`rooms/${currentRoomCode}/doctorTarget`).set(id);
                            alert(`تم اختيار حماية ${p.name}`);
                        };
                        actionArea.appendChild(btn);
                    }
                });

            // 4. المحقق
            } else if (myRole === 'محقق') {
                actionArea.innerHTML = '<h4>🔍 اختر لاعباً لكشف هويته:</h4>';
                Object.entries(room.players).forEach(([id, p]) => {
                    if (id !== playerId && p.alive) {
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-primary';
                        btn.innerText = `فحص ${p.name}`;
                        btn.onclick = () => {
                            const isMafia = p.role.includes('مافيا');
                            alert(`نتيجة التحقيق: اللاعب (${p.name}) يعتبر [${isMafia ? 'مافيا 🔪' : 'بريء 😇'}]`);
                        };
                        actionArea.appendChild(btn);
                    }
                });

            } else {
                actionArea.innerHTML = '<p>أنت نائم الآن... 🤫</p>';
            }
        } else {
            actionArea.innerHTML = '<p>أنت ميت 💀</p>';
        }

    } else if (phase === 'day') {
        document.getElementById('phaseDisplay').innerText = '☀️ مرحلة النهار والنقاش';
        chatSection.style.display = 'block';

        const isSilenced = room.silencedPlayerId === playerId;

        if (me && me.alive) {
            if (isSilenced) {
                document.getElementById('chatInput').disabled = true;
                document.getElementById('chatInput').placeholder = "🤐 مافيا التسكيت قامت بمنعك من الحديث هذه الجولة!";
                document.getElementById('btnSendChat').disabled = true;
                actionArea.innerHTML = '<p style="color:#f87171; font-weight:bold;">🤐 لقد تم تسكيتك من المافيا لهذه الجولة ولا يمكنك المشاركة بالشات!</p>';
            } else {
                document.getElementById('chatInput').disabled = false;
                document.getElementById('chatInput').placeholder = "اكتب رسالتك للنقاش...";
                document.getElementById('btnSendChat').disabled = false;
                actionArea.innerHTML = '<p>تناقشوا في الشات لاكتشاف المافيا!</p>';
            }
        } else {
            document.getElementById('chatInput').disabled = true;
            document.getElementById('chatInput').placeholder = "أنت ميت 💀 لا يمكنك المشاركة في المحادثة.";
            document.getElementById('btnSendChat').disabled = true;
            actionArea.innerHTML = '<p>أنت ميت 💀 يمكنك قراءة الشات فقط دون الكتابة.</p>';
        }

    } else if (phase === 'vote') {
        document.getElementById('phaseDisplay').innerText = '🗳️ مرحلة التصويت';

        if (me && me.alive) {
            chatSection.style.display = 'block';
            actionArea.innerHTML = '<h4>اختر من تصوت لطردِه:</h4>';
            Object.entries(room.players).forEach(([id, p]) => {
                if (id !== playerId && p.alive) {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-primary';
                    btn.innerText = `تصويت ضد ${p.name}`;
                    btn.onclick = () => {
                        db.ref(`rooms/${currentRoomCode}/votes/${playerId}`).set(id);
                        alert(`تم تسجيل صوتك ضد ${p.name}`);
                    };
                    actionArea.appendChild(btn);
                }
            });
        } else {
            chatSection.style.display = 'none';
            actionArea.innerHTML = '<p>الموتى لا يمكنهم التصويت 💀</p>';
        }
    }
}

function sendChatMessage() {
    if (!currentRoomCode || !playerId) return;

    db.ref(`rooms/${currentRoomCode}`).once('value', snap => {
        const room = snap.val();
        const player = room?.players?.[playerId];
        
        if (!player || !player.alive) return alert("أنت ميت ولا يمكنك إرسال الرسائل!");
        if (room.silencedPlayerId === playerId) return alert("تم تسكيتك من المافيا لهذه الجولة!");

        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;

        db.ref(`rooms/${currentRoomCode}/chat`).push({
            sender: playerName,
            text: text
        });
        input.value = '';
    });
}
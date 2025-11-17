// ============================================
// КОНФИГУРАЦИЯ
// ============================================

const CONFIG = {
    MAPBOX_TOKEN: 'pk.eyJ1IjoibXJoZXJvIiwiYSI6ImNtaTI1YmZsODFiODUyanNjZHRlaXRsaWYifQ.QMdYQgjDCxDLxSQmIUJJiw',
    SUPABASE_URL: 'https://otvtqoowhupqxushkmma.supabase.co',
    SUPABASE_KEY: 'sb_publishable_yeG_VzvaJW-0Pxikgrup7g_cYZXKLfn',
    CLAIM_DISTANCE: 100,
    BOT_USERNAME: 'AmsterdamTreasureHunt_bot'
};

let map;
let userLocation = null;
let userMarker = null;
let treasures = [];
let userClaims = [];
let selectedTreasure = null;
let watchId = null;
let supabase;
let currentUser = null;

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
        
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        
        const telegramUser = tg.initDataUnsafe?.user || {
            id: Math.floor(Math.random() * 1000000),
            username: 'TestUser'
        };
        
        currentUser = await initUser(telegramUser);
        
        document.getElementById('username').textContent = `@${currentUser.username || 'Anonymous'}`;
        document.getElementById('user-score').textContent = currentUser.score;
        
        await loadTreasures();
        await loadUserClaims();
        
        initMap();
        startLocationTracking();
        setupEventListeners();
        
        const hasSeenOnboarding = localStorage.getItem('onboarding_seen');
        if (!hasSeenOnboarding) {
            document.getElementById('onboarding-modal').style.display = 'flex';
        }
        
        setTimeout(() => {
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('app').style.display = 'block';
        }, 1000);
        
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('app').style.display = 'block';
    }
});

async function initUser(telegramUser) {
    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramUser.id)
            .single();
        
        if (existingUser) return existingUser;
        
        const { data: newUser } = await supabase
            .from('users')
            .insert([{
                telegram_id: telegramUser.id,
                username: telegramUser.username || `user${telegramUser.id}`,
                score: 0
            }])
            .select()
            .single();
        
        return newUser || {
            id: 1,
            telegram_id: telegramUser.id,
            username: telegramUser.username || 'TestUser',
            score: 0
        };
        
    } catch (error) {
        return {
            id: 1,
            telegram_id: telegramUser.id,
            username: telegramUser.username || 'TestUser',
            score: 0
        };
    }
}

async function loadTreasures() {
    try {
        const { data } = await supabase
            .from('treasures')
            .select('*')
            .eq('active', true);
        
        treasures = data || [];
        document.getElementById('total-treasures').textContent = treasures.length;
        updateStats();
        
    } catch (error) {
        console.error('Load treasures error:', error);
    }
}

async function loadUserClaims() {
    try {
        const { data } = await supabase
            .from('claims')
            .select('treasure_id')
            .eq('user_id', currentUser.id);
        
        userClaims = data ? data.map(c => c.treasure_id) : [];
        updateStats();
        
    } catch (error) {
        console.error('Load claims error:', error);
    }
}

function updateStats() {
    const claimed = userClaims.length;
    const remaining = treasures.length - claimed;
    
    document.getElementById('claimed-count').textContent = claimed;
    document.getElementById('remaining-count').textContent = remaining;
}

function initMap() {
    mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;
    
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [43.9360, 56.2965],
        zoom: 13,
        pitch: 45
    });
    
    map.on('load', () => {
        addTreasuresToMap();
    });
}

function addTreasuresToMap() {
    treasures.forEach(treasure => {
        const isClaimed = userClaims.includes(treasure.id);
        
        const el = document.createElement('div');
        el.className = `treasure-marker ${isClaimed ? 'claimed' : ''}`;
        el.innerHTML = isClaimed ? '✓' : (treasure.icon || '💎');
        
        el.addEventListener('click', () => {
            selectTreasure(treasure);
        });
        
        new mapboxgl.Marker(el)
            .setLngLat([treasure.lng, treasure.lat])
            .addTo(map);
    });
}

function startLocationTracking() {
    if (!navigator.geolocation) return;
    
    watchId = navigator.geolocation.watchPosition(
        updateUserLocation,
        handleLocationError,
        {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 5000
        }
    );
}

function updateUserLocation(position) {
    userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };
    
    if (userMarker) {
        userMarker.setLngLat([userLocation.lng, userLocation.lat]);
    } else {
        const el = document.createElement('div');
        el.className = 'user-marker';
        
        userMarker = new mapboxgl.Marker(el)
            .setLngLat([userLocation.lng, userLocation.lat])
            .addTo(map);
        
        map.flyTo({
            center: [userLocation.lng, userLocation.lat],
            zoom: 15
        });
    }
    
    if (selectedTreasure) {
        updateDistanceDisplay();
    }
}

function handleLocationError(error) {
    console.error('Location error:', error);
    
    userLocation = { lat: 56.2965, lng: 43.9360 };
    
    if (!userMarker) {
        const el = document.createElement('div');
        el.className = 'user-marker';
        
        userMarker = new mapboxgl.Marker(el)
            .setLngLat([userLocation.lng, userLocation.lat])
            .addTo(map);
    }
}

function selectTreasure(treasure) {
    selectedTreasure = treasure;
    
    document.getElementById('default-info').style.display = 'none';
    document.getElementById('treasure-info').style.display = 'block';
    
    document.getElementById('treasure-name').innerHTML = 
        `${treasure.icon || '💎'} ${treasure.name}`;
    document.getElementById('treasure-description').textContent = treasure.description;
    
    const imageContainer = document.getElementById('treasure-image-container');
    const imageElement = document.getElementById('treasure-image');
    
    if (treasure.image_url) {
        imageElement.src = treasure.image_url;
        imageContainer.style.display = 'block';
    } else {
        imageContainer.style.display = 'none';
    }
    
    const isClaimed = userClaims.includes(treasure.id);
    const claimBtn = document.getElementById('claim-btn');
    
    if (isClaimed) {
        claimBtn.textContent = '✓ Уже найдено';
        claimBtn.disabled = true;
        document.getElementById('distance-text').textContent = '✓ Сокровище найдено';
        return;
    }
    
    updateDistanceDisplay();
    
    map.flyTo({
        center: [treasure.lng, treasure.lat],
        zoom: 16
    });
}

function updateDistanceDisplay() {
    if (!selectedTreasure || !userLocation) return;
    
    const distance = calculateDistance(
        userLocation.lat,
        userLocation.lng,
        selectedTreasure.lat,
        selectedTreasure.lng
    );
    
    const distanceText = document.getElementById('distance-text');
    const claimBtn = document.getElementById('claim-btn');
    
    distanceText.textContent = `📍 ${Math.round(distance)}м от вас`;
    
    if (distance <= CONFIG.CLAIM_DISTANCE) {
        claimBtn.textContent = `🎁 Забрать ${selectedTreasure.points} очков!`;
        claimBtn.disabled = false;
        claimBtn.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
    } else {
        claimBtn.textContent = `🔒 Подойдите ближе (нужно ${CONFIG.CLAIM_DISTANCE}м)`;
        claimBtn.disabled = true;
        claimBtn.style.background = '#ccc';
    }
}

// ============================================
// СИСТЕМА ДОСТИЖЕНИЙ
// ============================================

async function checkAchievements() {
    try {
        const totalClaims = userClaims.length;
        const totalScore = currentUser.score;
        
        console.log(`🏆 Проверка достижений: ${totalClaims} находок, ${totalScore} очков`);
        
        const { data: allAchievements } = await supabase
            .from('achievements')
            .select('*');
        
        if (!allAchievements) return;
        
        const { data: unlockedAchievements } = await supabase
            .from('user_achievements')
            .select('achievement_id')
            .eq('user_id', currentUser.id);
        
        const unlockedIds = unlockedAchievements ? unlockedAchievements.map(a => a.achievement_id) : [];
        
        for (const achievement of allAchievements) {
            if (unlockedIds.includes(achievement.id)) continue;
            
            let unlocked = false;
            
            if (achievement.treasures_required > 0 && totalClaims >= achievement.treasures_required) {
                unlocked = true;
            }
            
            if (achievement.points_required > 0 && totalScore >= achievement.points_required) {
                unlocked = true;
            }
            
            if (achievement.code === 'historic_master') {
                const historicTreasures = treasures.filter(t => t.category === 'historic');
                const claimedHistoric = historicTreasures.filter(t => userClaims.includes(t.id));
                if (historicTreasures.length > 0 && claimedHistoric.length === historicTreasures.length) {
                    unlocked = true;
                }
            }
            
            if (achievement.code === 'nature_lover') {
                const natureTreasures = treasures.filter(t => t.category === 'nature');
                const claimedNature = natureTreasures.filter(t => userClaims.includes(t.id));
                if (natureTreasures.length > 0 && claimedNature.length === natureTreasures.length) {
                    unlocked = true;
                }
            }
            
            if (unlocked) {
                await unlockAchievement(achievement);
            }
        }
        
    } catch (error) {
        console.error('Ошибка проверки достижений:', error);
    }
}

async function unlockAchievement(achievement) {
    try {
        console.log(`🎉 Разблокировано: ${achievement.name}`);
        
        await supabase
            .from('user_achievements')
            .insert([{
                user_id: currentUser.id,
                achievement_id: achievement.id
            }]);
        
        showAchievementNotification(achievement);
        
    } catch (error) {
        console.error('Ошибка разблокировки достижения:', error);
    }
}

function showAchievementNotification(achievement) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 15px 25px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        z-index: 3000;
        font-weight: 600;
        text-align: center;
        animation: slideDown 0.5s ease;
    `;
    
    notification.innerHTML = `
        <div style="font-size: 32px; margin-bottom: 5px;">${achievement.icon}</div>
        <div style="font-size: 16px;">Достижение разблокировано!</div>
        <div style="font-size: 14px; opacity: 0.9; margin-top: 5px;">${achievement.name}</div>
    `;
    
    document.body.appendChild(notification);
    
    const sound = new Audio('https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3');
    sound.play().catch(e => {});
    
    setTimeout(() => {
        notification.style.animation = 'slideUp 0.5s ease';
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}

async function showAchievementsModal() {
    try {
        const { data: allAchievements } = await supabase
            .from('achievements')
            .select('*')
            .order('treasures_required', { ascending: true });
        
        const { data: unlockedData } = await supabase
            .from('user_achievements')
            .select('achievement_id')
            .eq('user_id', currentUser.id);
        
        const unlockedIds = unlockedData ? unlockedData.map(a => a.achievement_id) : [];
        
        const progress = unlockedIds.length;
        const total = allAchievements.length;
        const percentage = (progress / total) * 100;
        
        document.getElementById('achievements-progress').textContent = `${progress}/${total}`;
        document.getElementById('achievements-bar').style.width = `${percentage}%`;
        
        const listHTML = allAchievements.map(ach => {
            const isUnlocked = unlockedIds.includes(ach.id);
            
            return `
                <div style="
                    padding: 15px;
                    margin-bottom: 10px;
                    background: ${isUnlocked ? 'linear-gradient(135deg, #667eea20 0%, #764ba220 100%)' : '#f5f5f5'};
                    border-radius: 12px;
                    border-left: 4px solid ${isUnlocked ? '#667eea' : '#ccc'};
                    opacity: ${isUnlocked ? '1' : '0.6'};
                ">
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="font-size: 36px;">${ach.icon}</div>
                        <div style="flex: 1;">
                            <div style="font-weight: 600; color: ${isUnlocked ? '#667eea' : '#666'}; margin-bottom: 4px;">
                                ${ach.name} ${isUnlocked ? '✓' : '🔒'}
                            </div>
                            <div style="font-size: 13px; color: #888;">
                                ${ach.description}
                            </div>
                            ${ach.treasures_required > 0 ? `<div style="font-size: 12px; color: #aaa; margin-top: 4px;">Сокровищ: ${ach.treasures_required}</div>` : ''}
                            ${ach.points_required > 0 ? `<div style="font-size: 12px; color: #aaa; margin-top: 4px;">Очков: ${ach.points_required}</div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        document.getElementById('achievements-list').innerHTML = listHTML;
        document.getElementById('achievements-modal').style.display = 'flex';
        
    } catch (error) {
        console.error('Ошибка загрузки достижений:', error);
    }
}

// ============================================
// ЗАБРАТЬ СОКРОВИЩЕ
// ============================================

async function claimTreasure() {
    if (!selectedTreasure || !userLocation) return;
    
    const distance = calculateDistance(
        userLocation.lat,
        userLocation.lng,
        selectedTreasure.lat,
        selectedTreasure.lng
    );
    
    if (distance > CONFIG.CLAIM_DISTANCE) {
        alert('Вам нужно подойти ближе!');
        return;
    }
    
    try {
        const claimBtn = document.getElementById('claim-btn');
        claimBtn.disabled = true;
        claimBtn.textContent = 'Забираем...';
        
        await supabase
            .from('claims')
            .insert([{
                user_id: currentUser.id,
                treasure_id: selectedTreasure.id
            }]);
        
        const newScore = currentUser.score + selectedTreasure.points;
        await supabase
            .from('users')
            .update({ score: newScore })
            .eq('id', currentUser.id);
        
        currentUser.score = newScore;
        userClaims.push(selectedTreasure.id);
        
        document.getElementById('user-score').textContent = newScore;
        updateStats();
        
        const sound = document.getElementById('claim-sound');
        if (sound) sound.play().catch(e => {});
        
        document.getElementById('success-message').innerHTML = 
            `Ты заработал <strong>${selectedTreasure.points} очков</strong>!`;
        document.getElementById('success-modal').style.display = 'flex';
        
        await loadTreasures();
        
        // ПРОВЕРЯЕМ ДОСТИЖЕНИЯ
        await checkAchievements();
        
    } catch (error) {
        console.error('Claim error:', error);
        alert('Ошибка. Попробуйте снова.');
    }
}

function setupEventListeners() {
    document.getElementById('claim-btn').addEventListener('click', claimTreasure);
    
    document.getElementById('close-modal').addEventListener('click', () => {
        document.getElementById('success-modal').style.display = 'none';
        document.getElementById('treasure-info').style.display = 'none';
        document.getElementById('default-info').style.display = 'block';
        selectedTreasure = null;
    });
    
    document.getElementById('start-hunting').addEventListener('click', () => {
        localStorage.setItem('onboarding_seen', 'true');
        document.getElementById('onboarding-modal').style.display = 'none';
    });
    
    document.getElementById('invite-btn').addEventListener('click', () => {
        const tg = window.Telegram.WebApp;
        const shareText = encodeURIComponent('Найди сокровища в Нижнем Новгороде! 💎🗺️');
        const shareUrl = `https://t.me/share/url?url=https://t.me/${CONFIG.BOT_USERNAME}&text=${shareText}`;
        
        tg.openTelegramLink(shareUrl);
    });
    
    // Кнопка достижений
    document.getElementById('achievements-btn').addEventListener('click', showAchievementsModal);
    
    document.getElementById('close-achievements').addEventListener('click', () => {
        document.getElementById('achievements-modal').style.display = 'none';
    });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
}

window.addEventListener('beforeunload', () => {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
});

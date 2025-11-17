// ============================================
// КОНФИГУРАЦИЯ - ТВОИ КЛЮЧИ
// ============================================

const CONFIG = {
    MAPBOX_TOKEN: 'pk.eyJ1IjoibXJoZXJvIiwiYSI6ImNtaTI1YmZsODFiODUyanNjZHRlaXRsaWYifQ.QMdYQgjDCxDLxSQmIUJJiw',
    SUPABASE_URL: 'https://otvtqoowhupqxushkmma.supabase.co',
    SUPABASE_KEY: 'sb_publishable_yeG_VzvaJW-0Pxikgrup7g_cYZXKLfn',
    CLAIM_DISTANCE: 100,
    BOT_USERNAME: 'AmsterdamTreasureHunt_bot'
};

// ============================================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ============================================

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
            username: 'ТестПользователь'
        };
        
        currentUser = await initUser(telegramUser);
        
        document.getElementById('username').textContent = `@${currentUser.username || 'Аноним'}`;
        document.getElementById('user-score').textContent = currentUser.score;
        
        await loadTreasures();
        await loadUserClaims();
        
        initMap();
        startLocationTracking();
        setupEventListeners();
        showOnboardingIfNeeded();
        
        setTimeout(() => {
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('app').style.display = 'block';
        }, 1000);
        
    } catch (error) {
        console.error('Ошибка инициализации:', error);
        alert('Ошибка загрузки приложения. Проверьте консоль.');
    }
});

// ============================================
// ОНБОРДИНГ
// ============================================

function showOnboardingIfNeeded() {
    const hasSeenOnboarding = localStorage.getItem('onboarding_seen');
    if (!hasSeenOnboarding) {
        document.getElementById('onboarding-modal').style.display = 'flex';
    }
}

// ============================================
// УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
// ============================================

async function initUser(telegramUser) {
    try {
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramUser.id)
            .single();
        
        if (existingUser) {
            return existingUser;
        }
        
        const { data: newUser, error } = await supabase
            .from('users')
            .insert([{
                telegram_id: telegramUser.id,
                username: telegramUser.username || `user${telegramUser.id}`,
                score: 0
            }])
            .select()
            .single();
        
        if (error) throw error;
        return newUser;
        
    } catch (error) {
        console.error('Ошибка инициализации пользователя:', error);
        return {
            id: 1,
            telegram_id: telegramUser.id,
            username: telegramUser.username || 'ТестПользователь',
            score: 0
        };
    }
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================

async function loadTreasures() {
    try {
        const { data, error } = await supabase
            .from('treasures')
            .select('*')
            .eq('active', true);
        
        if (error) throw error;
        treasures = data || [];
        
        console.log('Загружено сокровищ:', treasures.length);
        
        document.getElementById('total-treasures').textContent = treasures.length;
        updateStats();
        
    } catch (error) {
        console.error('Ошибка загрузки сокровищ:', error);
    }
}

async function loadUserClaims() {
    try {
        const { data, error } = await supabase
            .from('claims')
            .select('treasure_id')
            .eq('user_id', currentUser.id);
        
        if (error) throw error;
        userClaims = data ? data.map(c => c.treasure_id) : [];
        
        updateStats();
        
    } catch (error) {
        console.error('Ошибка загрузки находок:', error);
    }
}

function updateStats() {
    const claimed = userClaims.length;
    const remaining = treasures.length - claimed;
    
    document.getElementById('claimed-count').textContent = claimed;
    document.getElementById('remaining-count').textContent = remaining;
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ КАРТЫ
// ============================================

function initMap() {
    mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;
    
    // НИЖНИЙ НОВГОРОД - ЦЕНТР ГОРОДА
    const center = [43.9360, 56.2965];
    
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: center,
        zoom: 12,
        pitch: 0
    });
    
    map.on('load', () => {
        console.log('Карта загружена, добавляем сокровища...');
        addTreasuresToMap();
    });
}

// ============================================
// ДОБАВЛЕНИЕ СОКРОВИЩ НА КАРТУ - ФИКС ИКОНОК
// ============================================

function addTreasuresToMap() {
    console.log('Добавление сокровищ на карту:', treasures.length);
    
    treasures.forEach((treasure, index) => {
        const isClaimed = userClaims.includes(treasure.id);
        
        console.log(`Сокровище ${index + 1}:`, treasure.name, treasure.icon, [treasure.lng, treasure.lat]);
        
        // Создание элемента маркера с УНИКАЛЬНОЙ ИКОНКОЙ
        const el = document.createElement('div');
        el.className = `treasure-marker ${isClaimed ? 'claimed' : ''}`;
        el.innerHTML = isClaimed ? '✓' : (treasure.icon || '💎');
        el.style.fontSize = '24px';
        
        // Добавление обработчика клика
        el.addEventListener('click', () => {
            selectTreasure(treasure);
        });
        
        // Добавление маркера на карту
        new mapboxgl.Marker(el)
            .setLngLat([treasure.lng, treasure.lat])
            .addTo(map);
    });
}

// ============================================
// ОТСЛЕЖИВАНИЕ ГЕОЛОКАЦИИ
// ============================================

function startLocationTracking() {
    if (!navigator.geolocation) {
        alert('Геолокация не поддерживается вашим браузером');
        return;
    }
    
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
    
    console.log('Позиция пользователя:', userLocation);
    
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
            zoom: 14
        });
    }
    
    if (selectedTreasure) {
        updateDistanceDisplay();
    }
}

function handleLocationError(error) {
    console.error('Ошибка геолокации:', error);
    
    // Fallback: центр Нижнего Новгорода
    userLocation = { lat: 56.2965, lng: 43.9360 };
    
    if (!userMarker) {
        const el = document.createElement('div');
        el.className = 'user-marker';
        
        userMarker = new mapboxgl.Marker(el)
            .setLngLat([userLocation.lng, userLocation.lat])
            .addTo(map);
    }
}

// ============================================
// ВЗАИМОДЕЙСТВИЕ С СОКРОВИЩАМИ
// ============================================

function selectTreasure(treasure) {
    selectedTreasure = treasure;
    
    console.log('Выбрано сокровище:', treasure);
    
    document.getElementById('default-info').style.display = 'none';
    document.getElementById('treasure-info').style.display = 'block';
    
    // Обновление информации С ИКОНКОЙ
    document.getElementById('treasure-name').innerHTML = 
        `${treasure.icon || '💎'} ${treasure.name}`;
    document.getElementById('treasure-description').textContent = treasure.description;
    
    // Показываем картинку если есть
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
        claimBtn.style.background = 'linear-gradient(135deg, #4a5568 0%, #2d3748 100%)';
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
        alert('Вам нужно подойти ближе, чтобы забрать это сокровище!');
        return;
    }
    
    try {
        const claimBtn = document.getElementById('claim-btn');
        claimBtn.disabled = true;
        claimBtn.textContent = 'Забираем...';
        
        const { error: claimError } = await supabase
            .from('claims')
            .insert([{
                user_id: currentUser.id,
                treasure_id: selectedTreasure.id
            }]);
        
        if (claimError) throw claimError;
        
        const newScore = currentUser.score + selectedTreasure.points;
        const { error: updateError } = await supabase
            .from('users')
            .update({ score: newScore })
            .eq('id', currentUser.id);
        
        if (updateError) throw updateError;
        
        currentUser.score = newScore;
        userClaims.push(selectedTreasure.id);
        
        document.getElementById('user-score').textContent = newScore;
        updateStats();
        
        showSuccessModal(selectedTreasure.points);
        
        await loadTreasures();
        
    } catch (error) {
        console.error('Ошибка при находке:', error);
        alert('Ошибка при находке сокровища. Попробуйте снова.');
    }
}

function showSuccessModal(points) {
    const sound = document.getElementById('claim-sound');
    if (sound) {
        sound.play().catch(e => console.log('Звук не воспроизведён:', e));
    }
    
    document.getElementById('success-message').innerHTML = 
        `Ты заработал <strong>${points} очков</strong>!`;
    document.getElementById('success-modal').style.display = 'flex';
}

// ============================================
// ОБРАБОТЧИКИ СОБЫТИЙ
// ============================================

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
}

// ============================================
// УТИЛИТЫ
// ============================================

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

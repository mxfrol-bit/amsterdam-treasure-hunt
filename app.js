// ============================================
// КОНФИГУРАЦИЯ - ТВОИ КЛЮЧИ
// ============================================

const CONFIG = {
    MAPBOX_TOKEN: 'pk.eyJ1IjoibXJoZXJvIiwiYSI6ImNtaTI1YmZsODFiODUyanNjZHRlaXRsaWYifQ.QMdYQgjDCxDLxSQmIUJJiw',
    SUPABASE_URL: 'https://otvtqoowhupqxushkmma.supabase.co',
    SUPABASE_KEY: 'sb_publishable_yeG_VzvaJW-0Pxikgrup7g_cYZXKLfn',
    CLAIM_DISTANCE: 100, // метров - для тестирования
    BOT_USERNAME: 'AmsterdamTreasureHunt_bot' // Замени на имя своего бота
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
        // Инициализация Supabase
        supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
        
        // Инициализация Telegram WebApp
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        
        // Получение данных пользователя из Telegram
        const telegramUser = tg.initDataUnsafe?.user || {
            id: Math.floor(Math.random() * 1000000), // Fallback для тестирования
            username: 'ТестПользователь'
        };
        
        // Инициализация пользователя в базе
        currentUser = await initUser(telegramUser);
        
        // Обновление UI с данными пользователя
        document.getElementById('username').textContent = `@${currentUser.username || 'Аноним'}`;
        document.getElementById('user-score').textContent = currentUser.score;
        
        // Загрузка сокровищ и находок пользователя
        await loadTreasures();
        await loadUserClaims();
        
        // Инициализация карты
        initMap();
        
        // Запуск отслеживания геолокации
        startLocationTracking();
        
        // Настройка обработчиков событий
        setupEventListeners();
        
        // Показ онбординга для новых пользователей
        showOnboardingIfNeeded();
        
        // Скрытие экрана загрузки
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
        // Проверка существования пользователя
        const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramUser.id)
            .single();
        
        if (existingUser) {
            return existingUser;
        }
        
        // Создание нового пользователя
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
        // Возврат fallback пользователя для тестирования
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
    
    // Центр карты - Нижний Новгород
    const center = [43.9360, 56.2965];
    
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: center,
        zoom: 13,
        pitch: 45
    });
    
    map.on('load', () => {
        // Добавление сокровищ на карту
        addTreasuresToMap();
    });
}

function addTreasuresToMap() {
    treasures.forEach(treasure => {
        const isClaimed = userClaims.includes(treasure.id);
        
        // Создание элемента маркера
        const el = document.createElement('div');
        el.className = `treasure-marker ${isClaimed ? 'claimed' : ''}`;
        el.innerHTML = isClaimed ? '✓' : '💎';
        
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
    
    // Обновление или создание маркера пользователя
    if (userMarker) {
        userMarker.setLngLat([userLocation.lng, userLocation.lat]);
    } else {
        const el = document.createElement('div');
        el.className = 'user-marker';
        
        userMarker = new mapboxgl.Marker(el)
            .setLngLat([userLocation.lng, userLocation.lat])
            .addTo(map);
        
        // Центрирование карты на пользователе (только первый раз)
        map.flyTo({
            center: [userLocation.lng, userLocation.lat],
            zoom: 15
        });
    }
    
    // Обновление расстояния до выбранного сокровища
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
    
    // Показ панели информации о сокровище
    document.getElementById('default-info').style.display = 'none';
    document.getElementById('treasure-info').style.display = 'block';
    
    // Обновление информации
    document.getElementById('treasure-name').textContent = treasure.name;
    document.getElementById('treasure-description').textContent = treasure.description;
    
    // Проверка, найдено ли уже
    const isClaimed = userClaims.includes(treasure.id);
    const claimBtn = document.getElementById('claim-btn');
    
    if (isClaimed) {
        claimBtn.textContent = '✓ Уже найдено';
        claimBtn.disabled = true;
        document.getElementById('distance-text').textContent = '✓ Сокровище найдено';
        return;
    }
    
    // Обновление расстояния и состояния кнопки
    updateDistanceDisplay();
    
    // Перелёт к сокровищу
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
        // Отключение кнопки
        const claimBtn = document.getElementById('claim-btn');
        claimBtn.disabled = true;
        claimBtn.textContent = 'Забираем...';
        
        // Вставка записи о находке
        const { error: claimError } = await supabase
            .from('claims')
            .insert([{
                user_id: currentUser.id,
                treasure_id: selectedTreasure.id
            }]);
        
        if (claimError) throw claimError;
        
        // Обновление счёта пользователя
        const newScore = currentUser.score + selectedTreasure.points;
        const { error: updateError } = await supabase
            .from('users')
            .update({ score: newScore })
            .eq('id', currentUser.id);
        
        if (updateError) throw updateError;
        
        // Обновление локального состояния
        currentUser.score = newScore;
        userClaims.push(selectedTreasure.id);
        
        // Обновление UI
        document.getElementById('user-score').textContent = newScore;
        updateStats();
        
        // Показ модального окна успеха
        showSuccessModal(selectedTreasure.points);
        
        // Перезагрузка сокровищ для обновления UI
        await loadTreasures();
        
    } catch (error) {
        console.error('Ошибка при находке:', error);
        alert('Ошибка при находке сокровища. Попробуйте снова.');
    }
}

function showSuccessModal(points) {
    // Воспроизведение звука
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
    // Кнопка "Забрать"
    document.getElementById('claim-btn').addEventListener('click', claimTreasure);
    
    // Закрытие модального окна успеха
    document.getElementById('close-modal').addEventListener('click', () => {
        document.getElementById('success-modal').style.display = 'none';
        
        // Возврат к виду по умолчанию
        document.getElementById('treasure-info').style.display = 'none';
        document.getElementById('default-info').style.display = 'block';
        selectedTreasure = null;
    });
    
    // Кнопка "Начать охоту" (онбординг)
    document.getElementById('start-hunting').addEventListener('click', () => {
        localStorage.setItem('onboarding_seen', 'true');
        document.getElementById('onboarding-modal').style.display = 'none';
    });
    
    // Кнопка "Пригласить друзей"
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
    const R = 6371e3; // Радиус Земли в метрах
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c; // Расстояние в метрах
}

// Очистка при выгрузке страницы
window.addEventListener('beforeunload', () => {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
});

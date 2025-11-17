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
let isFirstLocation = true; // Для центрирования только первый раз

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🚀 Инициализация приложения...');
        
        // Инициализация Supabase
        supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
        console.log('✅ Supabase подключён');
        
        // Инициализация Telegram WebApp
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        console.log('✅ Telegram WebApp готов');
        
        // Получение данных пользователя из Telegram
        const telegramUser = tg.initDataUnsafe?.user || {
            id: Math.floor(Math.random() * 1000000),
            username: 'ТестПользователь'
        };
        
        console.log('👤 Пользователь:', telegramUser.username);
        
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
            console.log('✅ Приложение загружено');
        }, 1000);
        
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        alert('Ошибка загрузки приложения. Проверьте консоль.');
    }
});

// ============================================
// ОНБОРДИНГ
// ============================================

function showOnboardingIfNeeded() {
    const hasSeenOnboarding = localStorage.getItem('onboarding_seen');
    if (!hasSeenOnboarding) {
        console.log('📖 Показываем онбординг');
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
            console.log('✅ Пользователь найден в БД');
            return existingUser;
        }
        
        // Создание нового пользователя
        console.log('🆕 Создаём нового пользователя');
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
        console.error('❌ Ошибка инициализации пользователя:', error);
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
        console.log('📦 Загрузка сокровищ...');
        const { data, error } = await supabase
            .from('treasures')
            .select('*')
            .eq('active', true);
        
        if (error) throw error;
        treasures = data || [];
        
        console.log(`✅ Загружено сокровищ: ${treasures.length}`);
        
        if (treasures.length === 0) {
            console.warn('⚠️ В базе нет сокровищ!');
        }
        
        document.getElementById('total-treasures').textContent = treasures.length;
        updateStats();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки сокровищ:', error);
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
        
        console.log(`✅ Найдено пользователем: ${userClaims.length}`);
        
        updateStats();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки находок:', error);
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
    console.log('🗺️ Инициализация карты...');
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
        console.log('✅ Карта загружена');
        addTreasuresToMap();
    });
}

// ============================================
// ДОБАВЛЕНИЕ СОКРОВИЩ НА КАРТУ
// ============================================

function addTreasuresToMap() {
    console.log('=== ДОБАВЛЕНИЕ СОКРОВИЩ НА КАРТУ ===');
    console.log(`Всего сокровищ для добавления: ${treasures.length}`);
    
    if (treasures.length === 0) {
        console.error('❌ ОШИБКА: Сокровища не загружены из базы!');
        alert('Сокровища не загружены. Проверьте базу данных в Supabase.');
        return;
    }
    
    treasures.forEach((treasure, index) => {
        const isClaimed = userClaims.includes(treasure.id);
        
        console.log(`${index + 1}. ${treasure.name}:`, {
            icon: treasure.icon || '💎',
            coords: [treasure.lng, treasure.lat],
            claimed: isClaimed
        });
        
        // Создание элемента маркера с УНИКАЛЬНОЙ ИКОНКОЙ
        const el = document.createElement('div');
        el.className = `treasure-marker ${isClaimed ? 'claimed' : ''}`;
        el.innerHTML = isClaimed ? '✓' : (treasure.icon || '💎');
        
        // Добавление обработчика клика
        el.addEventListener('click', () => {
            console.log('🖱️ Клик по сокровищу:', treasure.name);
            selectTreasure(treasure);
        });
        
        // Добавление маркера на карту
        const marker = new mapboxgl.Marker(el)
            .setLngLat([treasure.lng, treasure.lat])
            .addTo(map);
            
        console.log(`✅ Маркер добавлен: ${treasure.name}`);
    });
    
    console.log('=== ДОБАВЛЕНИЕ СОКРОВИЩ ЗАВЕРШЕНО ===');
}

// ============================================
// ОТСЛЕЖИВАНИЕ ГЕОЛОКАЦИИ
// ============================================

function startLocationTracking() {
    console.log('📍 Запуск отслеживания геолокации...');
    
    if (!navigator.geolocation) {
        console.error('❌ Геолокация не поддерживается');
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
    
    console.log('📍 Позиция пользователя:', userLocation);
    
    // Обновление или создание маркера пользователя
    if (userMarker) {
        // Просто обновляем позицию без перемещения карты
        userMarker.setLngLat([userLocation.lng, userLocation.lat]);
    } else {
        // Создаём маркер только при первой загрузке
        const el = document.createElement('div');
        el.className = 'user-marker';
        
        userMarker = new mapboxgl.Marker(el)
            .setLngLat([userLocation.lng, userLocation.lat])
            .addTo(map);
        
        // Центрируем карту ТОЛЬКО ПЕРВЫЙ РАЗ
        if (isFirstLocation) {
            console.log('🎯 Центрируем карту на пользователя (первый раз)');
            map.flyTo({
                center: [userLocation.lng, userLocation.lat],
                zoom: 14,
                duration: 2000
            });
            isFirstLocation = false;
        }
    }
    
    // Обновление расстояния до выбранного сокровища
    if (selectedTreasure) {
        updateDistanceDisplay();
    }
}

function handleLocationError(error) {
    console.error('❌ Ошибка геолокации:', error.message);
    
    // Fallback: центр Нижнего Новгорода
    userLocation = { lat: 56.2965, lng: 43.9360 };
    
    if (!userMarker) {
        const el = document.createElement('div');
        el.className = 'user-marker';
        
        userMarker = new mapboxgl.Marker(el)
            .setLngLat([userLocation.lng, userLocation.lat])
            .addTo(map);
            
        console.log('⚠️ Используем fallback позицию: центр Нижнего Новгорода');
    }
}

// ============================================
// ВЗАИМОДЕЙСТВИЕ С СОКРОВИЩАМИ
// ============================================

function selectTreasure(treasure) {
    selectedTreasure = treasure;
    
    console.log('🎯 Выбрано сокровище:', treasure.name);
    
    // Показ панели информации о сокровище
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
        console.log('🖼️ Показываем картинку');
    } else {
        imageContainer.style.display = 'none';
    }
    
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
    
    // Перелёт к сокровищу (анимированный)
    map.flyTo({
        center: [treasure.lng, treasure.lat],
        zoom: 16,
        duration: 1500
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
        console.log('✅ Можно забрать сокровище!');
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
    
    console.log(`🎁 Попытка забрать сокровище. Расстояние: ${Math.round(distance)}м`);
    
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
        
        console.log(`✅ Сокровище найдено! Новый счёт: ${newScore}`);
        
        // Показ модального окна успеха
        showSuccessModal(selectedTreasure.points);
        
        // Перезагрузка сокровищ для обновления UI
        await loadTreasures();
        
    } catch (error) {
        console.error('❌ Ошибка при находке:', error);
        alert('Ошибка при находке сокровища. Попробуйте снова.');
    }
}

function showSuccessModal(points) {
    // Воспроизведение звука
    const sound = document.getElementById('claim-sound');
    if (sound) {
        sound.play().catch(e => console.log('🔇 Звук не воспроизведён:', e));
    }
    
    document.getElementById('success-message').innerHTML = 
        `Ты заработал <strong>${points} очков</strong>!`;
    document.getElementById('success-modal').style.display = 'flex';
    
    console.log('🎉 Показываем модальное окно успеха');
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
        
        console.log('ℹ️ Закрыто модальное окно');
    });
    
    // Кнопка "Начать охоту" (онбординг)
    document.getElementById('start-hunting').addEventListener('click', () => {
        localStorage.setItem('onboarding_seen', 'true');
        document.getElementById('onboarding-modal').style.display = 'none';
        console.log('✅ Онбординг завершён');
    });
    
    // Кнопка "Пригласить друзей"
    document.getElementById('invite-btn').addEventListener('click', () => {
        const tg = window.Telegram.WebApp;
        const shareText = encodeURIComponent('Найди сокровища в Нижнем Новгороде! 💎🗺️');
        const shareUrl = `https://t.me/share/url?url=https://t.me/${CONFIG.BOT_USERNAME}&text=${shareText}`;
        
        tg.openTelegramLink(shareUrl);
        console.log('👥 Открываем реферальную ссылку');
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
        console.log('🛑 Остановлено отслеживание геолокации');
    }
});
```

---



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



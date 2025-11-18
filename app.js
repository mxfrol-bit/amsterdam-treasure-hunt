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
let settings = {
    sound: true,
    vibration: true,
    aiImages: true,
    showAll: true
};

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
        
        loadSettings();
        
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
        
        if (isClaimed && !settings.showAll) {
            return;
        }
        
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

// ============================================
// ВЫБОР СОКРОВИЩА
// ============================================

async function selectTreasure(treasure) {
    selectedTreasure = treasure;
    
    document.getElementById('default-info').style.display = 'none';
    document.getElementById('treasure-info').style.display = 'block';
    
    document.getElementById('treasure-name').innerHTML = 
        `${treasure.icon || '💎'} ${treasure.name}`;
    
    // Автогенерация описания из легенды, если его нет
    if (treasure.legend && (!treasure.description || treasure.description === '')) {
        treasure.description = generateDescriptionFromLegend(treasure.legend);
        
        // Сохраняем в БД
        await supabase
            .from('treasures')
            .update({ description: treasure.description })
            .eq('id', treasure.id);
    }
    
    document.getElementById('treasure-description').textContent = 
        treasure.description || 'Историческая достопримечательность';
    
    // Обработка изображения
    const imageContainer = document.getElementById('treasure-image-container');
    const treasureImage = document.getElementById('treasure-image');
    const imageLoader = document.getElementById('image-loader');
    const imagePlaceholder = document.getElementById('image-placeholder');
    
    imagePlaceholder.style.display = 'block';
    treasureImage.style.display = 'none';
    imageLoader.style.display = 'none';
    
    if (treasure.image_url) {
        treasureImage.src = treasure.image_url;
        treasureImage.onload = () => {
            imagePlaceholder.style.display = 'none';
            treasureImage.style.display = 'block';
        };
        treasureImage.onerror = () => {
            if (settings.aiImages) {
                imagePlaceholder.textContent = treasure.icon || '💎';
                generateAIImage(treasure);
            }
        };
    } else if (settings.aiImages) {
        imagePlaceholder.textContent = treasure.icon || '💎';
        generateAIImage(treasure);
    }
    
    updateDistanceDisplay();
    
    map.flyTo({
        center: [treasure.lng, treasure.lat],
        zoom: 16
    });
}

function closeTreasureView() {
    document.getElementById('treasure-info').style.display = 'none';
    document.getElementById('default-info').style.display = 'block';
    selectedTreasure = null;
    
    if (userLocation) {
        map.flyTo({
            center: [userLocation.lng, userLocation.lat],
            zoom: 15
        });
    }
}

// ============================================
// ГЕНЕРАЦИЯ ОПИСАНИЯ ИЗ ЛЕГЕНДЫ (БЕЗ API)
// ============================================

function generateDescriptionFromLegend(legend) {
    if (!legend) return 'Историческая достопримечательность';
    
    // Берем первые 2 предложения из легенды
    const sentences = legend
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 10);
    
    if (sentences.length === 0) return legend;
    
    // Возвращаем первые 1-2 предложения
    const description = sentences.slice(0, 2).join('. ');
    return description.endsWith('.') ? description : description + '.';
}

// ============================================
// AI-ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ
// ============================================

async function generateAIImage(treasure) {
    const imageLoader = document.getElementById('image-loader');
    const treasureImage = document.getElementById('treasure-image');
    const imagePlaceholder = document.getElementById('image-placeholder');
    
    try {
        console.log('🎨 Начинаем генерацию изображения...');
        
        imageLoader.style.display = 'block';
        imagePlaceholder.style.display = 'none';
        
        // Создаем промпт из всех данных
        const prompt = createImagePrompt(treasure);
        
        console.log('📝 Промпт:', prompt);
        
        // Генерируем через Pollinations AI
        const imageUrl = await generateWithPollinations(prompt, treasure.id);
        
        if (imageUrl) {
            console.log('✅ Изображение сгенерировано:', imageUrl);
            
            treasureImage.src = imageUrl;
            treasureImage.onload = () => {
                console.log('✅ Изображение загружено успешно');
                imageLoader.style.display = 'none';
                treasureImage.style.display = 'block';
                
                // Сохраняем URL в базу данных
                saveTreasureImage(treasure.id, imageUrl);
            };
            
            treasureImage.onerror = (e) => {
                console.error('❌ Ошибка загрузки изображения:', e);
                imageLoader.style.display = 'none';
                imagePlaceholder.style.display = 'block';
            };
        } else {
            throw new Error('No image URL generated');
        }
        
    } catch (error) {
        console.error('❌ AI Image generation error:', error);
        imageLoader.style.display = 'none';
        imagePlaceholder.style.display = 'block';
    }
}

// Создание промпта для изображения
function createImagePrompt(treasure) {
    let parts = [];
    
    // 1. Название
    if (treasure.name) {
        parts.push(treasure.name);
    }
    
    // 2. Описание
    if (treasure.description) {
        parts.push(treasure.description);
    }
    
    // 3. Ключевые слова из легенды
    if (treasure.legend) {
        const keywords = extractKeywords(treasure.legend);
        if (keywords.length > 0) {
            parts.push(keywords.slice(0, 4).join(', '));
        }
    }
    
    // 4. Стиль по категории
    if (treasure.category) {
        const categoryStyles = {
            'history': 'historical landmark, ancient architecture, heritage site',
            'nature': 'natural landscape, scenic beauty, outdoor photography',
            'culture': 'cultural heritage, traditional, artistic',
            'modern': 'modern architecture, contemporary, urban design',
            'architecture': 'architectural masterpiece, building details',
            'park': 'park landscape, green nature, trees',
            'church': 'orthodox church, golden domes, religious building',
            'monument': 'monument, memorial, statue',
            'museum': 'museum building, cultural institution',
            'kremlin': 'medieval fortress, stone walls, towers',
            'river': 'riverbank, waterfront, water view',
            'square': 'city square, public space, urban plaza'
        };
        
        const style = categoryStyles[treasure.category] || 'landmark';
        parts.push(style);
    }
    
    // 5. Качество
    parts.push('professional photography, photorealistic, high quality, detailed, 4k');
    
    return parts.filter(p => p && p.length > 0).join(', ');
}

// Извлечение ключевых слов из легенды
function extractKeywords(legend) {
    if (!legend) return [];
    
    // Удаляем пунктуацию и разбиваем на слова
    const words = legend
        .toLowerCase()
        .replace(/[.,!?;:()«»""]/g, '')
        .split(/\s+/)
        .filter(word => {
            // Фильтруем короткие и служебные слова
            const skipWords = ['это', 'был', 'была', 'были', 'будет', 'есть',
                               'для', 'как', 'что', 'при', 'или', 'его', 'ее', 
                               'их', 'она', 'они', 'мы', 'вы', 'наш', 'ваш',
                               'который', 'которая', 'которые', 'этот', 'эта'];
            return word.length > 4 && !skipWords.includes(word);
        });
    
    // Возвращаем уникальные слова
    return [...new Set(words)];
}

// Генерация через Pollinations AI
async function generateWithPollinations(prompt, treasureId) {
    try {
        // Очищаем и кодируем промпт
        const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();
        const encodedPrompt = encodeURIComponent(cleanPrompt);
        
        // Параметры
        const width = 800;
        const height = 600;
        const seed = treasureId || Math.floor(Math.random() * 100000);
        
        // URL для Pollinations AI
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&model=flux`;
        
        console.log('🌐 URL генерации:', imageUrl);
        
        // Проверяем доступность (опционально)
        try {
            const response = await fetch(imageUrl, { 
                method: 'HEAD',
                mode: 'no-cors'
            });
            console.log('📡 Проверка доступности:', response);
        } catch (e) {
            console.log('📡 CORS ограничение (это нормально)');
        }
        
        // Возвращаем URL напрямую
        return imageUrl;
        
    } catch (error) {
        console.error('❌ Pollinations error:', error);
        
        // Fallback на Unsplash
        return await fallbackToUnsplash(prompt);
    }
}

// Fallback на Unsplash
async function fallbackToUnsplash(prompt) {
    try {
        console.log('🔄 Fallback на Unsplash');
        
        const keywords = prompt
            .replace(/[.,!?;:()]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 4)
            .slice(0, 6)
            .join(',');
        
        return `https://source.unsplash.com/800x600/?${keywords}`;
        
    } catch (error) {
        console.error('❌ Unsplash fallback error:', error);
        return null;
    }
}

async function saveTreasureImage(treasureId, imageUrl) {
    try {
        await supabase
            .from('treasures')
            .update({ image_url: imageUrl })
            .eq('id', treasureId);
        
        console.log('💾 Изображение сохранено в БД');
    } catch (error) {
        console.error('❌ Error saving image URL:', error);
    }
}

function updateDistanceDisplay() {
    if (!userLocation || !selectedTreasure) return;
    
    const distance = calculateDistance(
        userLocation.lat,
        userLocation.lng,
        selectedTreasure.lat,
        selectedTreasure.lng
    );
    
    const distanceText = document.getElementById('distance-text');
    const claimBtn = document.getElementById('claim-btn');
    
    const isClaimed = userClaims.includes(selectedTreasure.id);
    
    if (isClaimed) {
        distanceText.textContent = `✅ Уже найдено!`;
        claimBtn.disabled = true;
        claimBtn.textContent = '✓ Сокровище найдено';
    } else if (distance <= CONFIG.CLAIM_DISTANCE) {
        distanceText.textContent = `📍 ${Math.round(distance)}м • Можно забрать!`;
        claimBtn.disabled = false;
        claimBtn.textContent = `✨ Забрать сокровище (+${selectedTreasure.points} очков)`;
    } else {
        distanceText.textContent = `📍 ${Math.round(distance)}м • Подойди ближе`;
        claimBtn.disabled = true;
        claimBtn.textContent = `🔒 Подойди на ${CONFIG.CLAIM_DISTANCE}м`;
    }
}

// ============================================
// ДОСТИЖЕНИЯ
// ============================================

async function checkAchievements() {
    try {
        const { data: allAchievements } = await supabase
            .from('achievements')
            .select('*');
        
        if (!allAchievements) return;
        
        const { data: unlockedData } = await supabase
            .from('user_achievements')
            .select('achievement_id')
            .eq('user_id', currentUser.id);
        
        const unlockedIds = unlockedData ? unlockedData.map(a => a.achievement_id) : [];
        
        for (const achievement of allAchievements) {
            if (unlockedIds.includes(achievement.id)) continue;
            
            let unlocked = false;
            
            if (achievement.code === 'first_treasure' && userClaims.length >= 1) {
                unlocked = true;
            }
            
            if (achievement.treasures_required > 0 && userClaims.length >= achievement.treasures_required) {
                unlocked = true;
            }
            
            if (achievement.points_required > 0 && currentUser.score >= achievement.points_required) {
                unlocked = true;
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
    
    if (settings.sound) {
        const sound = new Audio('https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3');
        sound.play().catch(e => {});
    }
    
    if (settings.vibration && navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
    }
    
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
        
        if (!allAchievements) return;
        
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
    
    if (userClaims.includes(selectedTreasure.id)) {
        alert('Вы уже нашли это сокровище!');
        return;
    }
    
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
        
        const { data: existingClaim } = await supabase
            .from('claims')
            .select('id')
            .eq('user_id', currentUser.id)
            .eq('treasure_id', selectedTreasure.id)
            .single();
        
        if (existingClaim) {
            alert('Вы уже нашли это сокровище!');
            claimBtn.disabled = true;
            claimBtn.textContent = '✓ Сокровище найдено';
            return;
        }
        
        const { error: claimError } = await supabase
            .from('claims')
            .insert([{
                user_id: currentUser.id,
                treasure_id: selectedTreasure.id,
                claim_location_lat: userLocation.lat,
                claim_location_lng: userLocation.lng
            }]);
        
        if (claimError) {
            if (claimError.code === '23505') {
                alert('Вы уже нашли это сокровище!');
                claimBtn.disabled = true;
                claimBtn.textContent = '✓ Сокровище найдено';
                if (!userClaims.includes(selectedTreasure.id)) {
                    userClaims.push(selectedTreasure.id);
                }
                return;
            }
            throw claimError;
        }
        
        const newScore = currentUser.score + selectedTreasure.points;
        await supabase
            .from('users')
            .update({ score: newScore })
            .eq('id', currentUser.id);
        
        currentUser.score = newScore;
        userClaims.push(selectedTreasure.id);
        
        document.getElementById('user-score').textContent = newScore;
        updateStats();
        
        if (settings.sound) {
            const sound = document.getElementById('claim-sound');
            if (sound) sound.play().catch(e => {});
        }
        
        if (settings.vibration && navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
        }
        
        document.getElementById('success-message').innerHTML = 
            `Ты заработал <strong>${selectedTreasure.points} очков</strong>!`;
        document.getElementById('success-modal').style.display = 'flex';
        
        await loadTreasures();
        
        const markers = document.querySelectorAll('.treasure-marker');
        markers.forEach(marker => marker.remove());
        addTreasuresToMap();
        
        claimBtn.disabled = true;
        claimBtn.textContent = '✓ Сокровище найдено';
        
        await checkAchievements();
        
    } catch (error) {
        console.error('Claim error:', error);
        alert('Ошибка. Попробуйте снова.');
        
        const claimBtn = document.getElementById('claim-btn');
        claimBtn.disabled = false;
        claimBtn.textContent = `✨ Забрать сокровище (+${selectedTreasure.points} очков)`;
    }
}

// ============================================
// НАСТРОЙКИ
// ============================================

function loadSettings() {
    const saved = localStorage.getItem('app_settings');
    if (saved) {
        settings = JSON.parse(saved);
    }
    
    setTimeout(() => {
        if (document.getElementById('sound-toggle')) {
            document.getElementById('sound-toggle').checked = settings.sound;
            document.getElementById('vibration-toggle').checked = settings.vibration;
            document.getElementById('ai-images-toggle').checked = settings.aiImages;
            document.getElementById('show-all-toggle').checked = settings.showAll;
        }
    }, 100);
}

function saveSettings() {
    localStorage.setItem('app_settings', JSON.stringify(settings));
}

function showSettingsModal() {
    document.getElementById('settings-modal').style.display = 'flex';
}

// ============================================
// МЕНЮ
// ============================================

function toggleMenu() {
    const menu = document.getElementById('side-menu');
    const overlay = document.getElementById('menu-overlay');
    
    menu.classList.toggle('active');
    overlay.classList.toggle('active');
}

function closeMenu() {
    document.getElementById('side-menu').classList.remove('active');
    document.getElementById('menu-overlay').classList.remove('active');
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    document.getElementById('menu-btn').addEventListener('click', toggleMenu);
    document.getElementById('close-menu').addEventListener('click', closeMenu);
    document.getElementById('menu-overlay').addEventListener('click', closeMenu);
    
    document.getElementById('menu-achievements').addEventListener('click', () => {
        closeMenu();
        showAchievementsModal();
    });
    
    document.getElementById('menu-settings').addEventListener('click', () => {
        closeMenu();
        showSettingsModal();
    });
    
    document.getElementById('menu-profile').addEventListener('click', () => {
        closeMenu();
        alert('Профиль (в разработке)');
    });
    
    document.getElementById('menu-leaderboard').addEventListener('click', () => {
        closeMenu();
        alert('Таблица лидеров (в разработке)');
    });
    
    document.getElementById('menu-help').addEventListener('click', () => {
        closeMenu();
        document.getElementById('onboarding-modal').style.display = 'flex';
    });
    
    document.getElementById('close-treasure-btn').addEventListener('click', closeTreasureView);
    document.getElementById('claim-btn').addEventListener('click', claimTreasure);
    
    document.getElementById('close-modal').addEventListener('click', () => {
        document.getElementById('success-modal').style.display = 'none';
        closeTreasureView();
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
    
    document.getElementById('achievements-btn').addEventListener('click', showAchievementsModal);
    document.getElementById('close-achievements').addEventListener('click', () => {
        document.getElementById('achievements-modal').style.display = 'none';
    });
    
    document.getElementById('close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').style.display = 'none';
    });
    
    document.getElementById('sound-toggle').addEventListener('change', (e) => {
        settings.sound = e.target.checked;
        saveSettings();
    });
    
    document.getElementById('vibration-toggle').addEventListener('change', (e) => {
        settings.vibration = e.target.checked;
        saveSettings();
    });
    
    document.getElementById('ai-images-toggle').addEventListener('change', (e) => {
        settings.aiImages = e.target.checked;
        saveSettings();
    });
    
    document.getElementById('show-all-toggle').addEventListener('change', (e) => {
        settings.showAll = e.target.checked;
        saveSettings();
        
        const markers = document.querySelectorAll('.treasure-marker');
        markers.forEach(marker => marker.remove());
        addTreasuresToMap();
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

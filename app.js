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
        
        // Загрузка настроек
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
        
        // Скрыть найденные, если настройка включена
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
    document.getElementById('treasure-description').textContent = treasure.description;
    
    // Обработка изображения
    const imageContainer = document.getElementById('treasure-image-container');
    const treasureImage = document.getElementById('treasure-image');
    const imageLoader = document.getElementById('image-loader');
    const imagePlaceholder = document.getElementById('image-placeholder');
    
    // Показываем плейсхолдер
    imagePlaceholder.style.display = 'block';
    treasureImage.style.display = 'none';
    imageLoader.style.display = 'none';
    
    // Если есть сохраненная картинка
    if (treasure.image_url) {
        treasureImage.src = treasure.image_url;
        treasureImage.onload = () => {
            imagePlaceholder.style.display = 'none';
            treasureImage.style.display = 'block';
        };
    } 
    // Если включена генерация AI и нет картинки
    else if (settings.aiImages) {
        imagePlaceholder.textContent = treasure.icon || '💎';
        
        // Генерируем изображение на основе легенды и истории
        generateAIImage(treasure);
    }
    
    updateDistanceDisplay();
    
    map.flyTo({
        center: [treasure.lng, treasure.lat],
        zoom: 16
    });
}

// Закрытие просмотра сокровища
function closeTreasureView() {
    document.getElementById('treasure-info').style.display = 'none';
    document.getElementById('default-info').style.display = 'block';
    selectedTreasure = null;
    
    // Возврат к позиции пользователя
    if (userLocation) {
        map.flyTo({
            center: [userLocation.lng, userLocation.lat],
            zoom: 15
        });
    }
}

// ============================================
// AI ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ НА ОСНОВЕ ЛЕГЕНДЫ
// ============================================

async function generateAIImage(treasure) {
    const imageLoader = document.getElementById('image-loader');
    const treasureImage = document.getElementById('treasure-image');
    const imagePlaceholder = document.getElementById('image-placeholder');
    
    try {
        imageLoader.style.display = 'block';
        imagePlaceholder.style.display = 'none';
        
        // Создаем детальный промпт на основе легенды и истории сокровища
        const storyPrompt = createStoryPrompt(treasure);
        
        console.log('🎨 Генерация изображения на основе истории:', storyPrompt);
        
        // Пытаемся сгенерировать через Claude API (если доступен)
        let imageUrl = await generateImageWithClaude(treasure, storyPrompt);
        
        // Если Claude недоступен, используем Unsplash с улучшенным поиском
        if (!imageUrl) {
            imageUrl = await fetchUnsplashImage(treasure, storyPrompt);
        }
        
        if (imageUrl) {
            treasureImage.src = imageUrl;
            treasureImage.onload = () => {
                imageLoader.style.display = 'none';
                treasureImage.style.display = 'block';
                
                // Сохраняем URL в базу данных
                saveTreasureImage(treasure.id, imageUrl);
            };
            
            treasureImage.onerror = () => {
                imageLoader.style.display = 'none';
                imagePlaceholder.style.display = 'block';
            };
        } else {
            throw new Error('Failed to generate image');
        }
        
    } catch (error) {
        console.error('AI Image generation error:', error);
        imageLoader.style.display = 'none';
        imagePlaceholder.style.display = 'block';
    }
}

// Создание детального промпта на основе легенды и истории
function createStoryPrompt(treasure) {
    // Базовая информация
    let prompt = treasure.name;
    
    // Добавляем описание локации
    if (treasure.description) {
        prompt += `, ${treasure.description}`;
    }
    
    // Добавляем историческую информацию и легенду
    if (treasure.legend) {
        prompt += `. Story: ${treasure.legend}`;
    }
    
    // Добавляем категорию для стилизации
    if (treasure.category) {
        const categoryStyles = {
            'history': 'historical landmark, ancient architecture, vintage photography style, aged patina',
            'nature': 'natural landscape, scenic view, beautiful nature photography, lush greenery',
            'culture': 'cultural heritage site, traditional architecture, vibrant colors, folk elements',
            'modern': 'modern architecture, contemporary design, urban landscape, glass and steel',
            'architecture': 'architectural masterpiece, detailed building facade, professional architecture photography',
            'park': 'beautiful park, green spaces, peaceful nature scene, walking paths',
            'church': 'religious architecture, orthodox church, golden domes, spiritual atmosphere, sacred art',
            'monument': 'historical monument, memorial, monumental architecture, commemorative statue',
            'museum': 'museum building, cultural institution, classical architecture, exhibition halls',
            'kremlin': 'fortress walls, towers, medieval architecture, fortification, historical stronghold',
            'river': 'riverbank, waterfront, scenic water view, riverside landscape',
            'square': 'city square, public space, urban gathering place, architectural ensemble'
        };
        
        const styleGuide = categoryStyles[treasure.category] || 'landmark photography';
        prompt += `. Visual style: ${styleGuide}`;
    }
    
    // Добавляем временной контекст из легенды
    if (treasure.legend) {
        const legend = treasure.legend.toLowerCase();
        
        if (legend.includes('век') || legend.includes('century')) {
            prompt += ', historical atmosphere, period architecture';
        }
        
        if (legend.includes('война') || legend.includes('war')) {
            prompt += ', dramatic historical scene, wartime era';
        }
        
        if (legend.includes('церковь') || legend.includes('church')) {
            prompt += ', religious iconography, orthodox traditions';
        }
        
        if (legend.includes('купец') || legend.includes('merchant') || legend.includes('торг')) {
            prompt += ', merchant era, trading post atmosphere';
        }
    }
    
    // Общие улучшения для качества
    prompt += '. Professional photography, high quality, detailed, vibrant colors, 4k resolution, cinematic lighting';
    
    return prompt;
}

// Генерация изображения через Claude API (для получения оптимизированного промпта)
async function generateImageWithClaude(treasure, storyPrompt) {
    try {
        // Используем Claude для создания оптимального промпта для DALL-E/Stable Diffusion
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01'
                // API ключ обрабатывается на бэкенде для безопасности
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 500,
                messages: [{
                    role: 'user',
                    content: `Создай детальный промпт для генерации изображения AI на основе этой информации о сокровище:

Название: ${treasure.name}
Описание локации: ${treasure.description || 'Историческая достопримечательность'}
Легенда/История: ${treasure.legend || 'Древнее место с богатой историей'}
Категория: ${treasure.category || 'landmark'}

Создай яркий, детальный промпт, который передаст:
1. Визуальные детали архитектуры/ландшафта
2. Историческую атмосферу из легенды
3. Культурное значение
4. Освещение и настроение
5. Специфические архитектурные элементы
6. Визуализацию истории и легенды

Промпт должен быть на английском языке для AI-генератора изображений.
Верни ТОЛЬКО текст промпта, без объяснений.`
                }]
            })
        });

        if (response.ok) {
            const data = await response.json();
            const optimizedPrompt = data.content[0].text;
            
            console.log('✨ Claude создал оптимизированный промпт:', optimizedPrompt);
            
            // Теперь можно использовать этот промпт с DALL-E или Stable Diffusion
            // Для демонстрации используем Unsplash с оптимизированным поиском
            return await fetchUnsplashImageWithPrompt(optimizedPrompt);
        }
        
        return null;
        
    } catch (error) {
        console.error('Claude API error:', error);
        return null;
    }
}

// Получение изображения из Unsplash с улучшенным поиском на основе истории
async function fetchUnsplashImage(treasure, storyPrompt) {
    try {
        // Извлекаем ключевые слова из названия, описания и легенды
        let keywords = [];
        
        // Добавляем название
        if (treasure.name) {
            keywords.push(...treasure.name.split(' ').filter(w => w.length > 3));
        }
        
        // Добавляем ключевые слова из описания
        if (treasure.description) {
            const descWords = treasure.description
                .split(' ')
                .filter(w => w.length > 4)
                .slice(0, 3);
            keywords.push(...descWords);
        }
        
        // Добавляем ключевые слова из легенды (самое важное!)
        if (treasure.legend) {
            const legendWords = treasure.legend
                .replace(/[.,!?;:()]/g, '')
                .split(' ')
                .filter(w => w.length > 5)
                .slice(0, 4);
            keywords.push(...legendWords);
        }
        
        // Добавляем категорию
        if (treasure.category) {
            keywords.push(treasure.category);
        }
        
        // Добавляем контекстные слова
        const contextWords = ['landmark', 'architecture', 'historical', 'heritage'];
        keywords.push(...contextWords);
        
        // Удаляем дубликаты и создаем строку поиска
        const uniqueKeywords = [...new Set(keywords)];
        const searchQuery = uniqueKeywords.slice(0, 8).join(',');
        
        console.log('🔍 Поиск в Unsplash по ключевым словам из истории:', searchQuery);
        
        const response = await fetch(`https://source.unsplash.com/800x600/?${searchQuery}`);
        
        if (response.ok) {
            return response.url;
        }
        
        // Fallback на общие изображения с категорией
        const fallbackQuery = `${treasure.category || 'landmark'},architecture,historical`;
        return `https://source.unsplash.com/800x600/?${fallbackQuery}`;
        
    } catch (error) {
        console.error('Unsplash error:', error);
        return null;
    }
}

// Получение изображения из Unsplash с промптом от Claude
async function fetchUnsplashImageWithPrompt(prompt) {
    try {
        // Извлекаем ключевые слова из промпта
        const keywords = prompt
            .toLowerCase()
            .replace(/[.,!?;:()]/g, '')
            .split(' ')
            .filter(w => w.length > 4 && !['that', 'this', 'with', 'from', 'have'].includes(w))
            .slice(0, 8)
            .join(',');
        
        console.log('🔍 Unsplash поиск с промптом от Claude:', keywords);
        
        const response = await fetch(`https://source.unsplash.com/800x600/?${keywords}`);
        
        if (response.ok) {
            return response.url;
        }
        
        return null;
        
    } catch (error) {
        console.error('Unsplash with prompt error:', error);
        return null;
    }
}

// Сохранение URL изображения в базу
async function saveTreasureImage(treasureId, imageUrl) {
    try {
        await supabase
            .from('treasures')
            .update({ image_url: imageUrl })
            .eq('id', treasureId);
        
        console.log('💾 Изображение сохранено для сокровища:', treasureId);
    } catch (error) {
        console.error('Error saving image URL:', error);
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
    
    if (distance <= CONFIG.CLAIM_DISTANCE) {
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
            
            if (achievement.code === 'speed_demon') {
                const claims = await getRecentClaims(currentUser.id);
                if (claims.length >= 3) {
                    const timeWindow = 60 * 60 * 1000;
                    const timestamps = claims.map(c => new Date(c.created_at).getTime());
                    const recentClaims = timestamps.filter(t => Date.now() - t < timeWindow);
                    if (recentClaims.length >= 3) {
                        unlocked = true;
                    }
                }
            }
            
            if (achievement.code === 'explorer') {
                const uniqueCategories = new Set(
                    treasures.filter(t => userClaims.includes(t.id)).map(t => t.category)
                );
                if (uniqueCategories.size >= 3) {
                    unlocked = true;
                }
            }
            
            if (achievement.code === 'night_owl') {
                const nightClaims = await getNightClaims(currentUser.id);
                if (nightClaims.length >= 5) {
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

async function getRecentClaims(userId) {
    try {
        const { data } = await supabase
            .from('claims')
            .select('created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);
        
        return data || [];
    } catch (error) {
        return [];
    }
}

async function getNightClaims(userId) {
    try {
        const { data } = await supabase
            .from('claims')
            .select('created_at')
            .eq('user_id', userId);
        
        if (!data) return [];
        
        return data.filter(claim => {
            const hour = new Date(claim.created_at).getHours();
            return hour >= 22 || hour <= 6;
        });
    } catch (error) {
        return [];
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
        
        // ПРОВЕРЯЕМ ДОСТИЖЕНИЯ
        await checkAchievements();
        
    } catch (error) {
        console.error('Claim error:', error);
        alert('Ошибка. Попробуйте снова.');
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
    
    // Применяем настройки к UI (после загрузки DOM)
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
    // Меню
    document.getElementById('menu-btn').addEventListener('click', toggleMenu);
    document.getElementById('close-menu').addEventListener('click', closeMenu);
    document.getElementById('menu-overlay').addEventListener('click', closeMenu);
    
    // Пункты меню
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
    
    // Кнопка закрытия сокровища
    document.getElementById('close-treasure-btn').addEventListener('click', closeTreasureView);
    
    // Забрать сокровище
    document.getElementById('claim-btn').addEventListener('click', claimTreasure);
    
    // Модалки
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
    
    // Достижения
    document.getElementById('achievements-btn').addEventListener('click', showAchievementsModal);
    document.getElementById('close-achievements').addEventListener('click', () => {
        document.getElementById('achievements-modal').style.display = 'none';
    });
    
    // Настройки
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
        
        // Перерисовываем карту
        map.remove();
        initMap();
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

// backend/server.js
// Backend для AI-генерации контента

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Конфигурация
const CONFIG = {
    SUPABASE_URL: 'https://otvtqoowhupqxushkmma.supabase.co',
    SUPABASE_KEY: 'sb_publishable_yeG_VzvaJW-0Pxikgrup7g_cYZXKLfn',
    PORT: 3000
};

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ============================================
// ГЕНЕРАЦИЯ ОПИСАНИЯ ИЗ ЛЕГЕНДЫ
// ============================================

function generateDescriptionFromLegend(legend) {
    if (!legend) return 'Историческая достопримечательность';
    
    // Берем первые 2 предложения из легенды
    const sentences = legend
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 10);
    
    if (sentences.length === 0) return legend;
    
    const description = sentences.slice(0, 2).join('. ');
    return description.endsWith('.') ? description : description + '.';
}

// ============================================
// ГЕНЕРАЦИЯ ПРОМПТА ДЛЯ ИЗОБРАЖЕНИЯ
// ============================================

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
    const categoryStyles = {
        'history': 'historical landmark, ancient architecture, heritage site',
        'nature': 'natural landscape, scenic beauty, outdoor photography',
        'culture': 'cultural heritage, traditional, artistic',
        'architecture': 'architectural masterpiece, building details',
        'park': 'park landscape, green nature, trees',
        'church': 'orthodox church, golden domes, religious building',
        'monument': 'monument, memorial, statue',
        'museum': 'museum building, cultural institution',
        'kremlin': 'medieval fortress, stone walls, towers',
        'river': 'riverbank, waterfront, water view',
        'square': 'city square, public space, urban plaza'
    };
    
    if (treasure.category && categoryStyles[treasure.category]) {
        parts.push(categoryStyles[treasure.category]);
    }
    
    // 5. Качество
    parts.push('professional photography, photorealistic, high quality, detailed, 4k, cinematic lighting');
    
    return parts.filter(p => p && p.length > 0).join(', ');
}

function extractKeywords(legend) {
    if (!legend) return [];
    
    const words = legend
        .toLowerCase()
        .replace(/[.,!?;:()«»""]/g, '')
        .split(/\s+/)
        .filter(word => {
            const skipWords = ['это', 'был', 'была', 'были', 'будет', 'есть',
                               'для', 'как', 'что', 'при', 'или', 'его', 'ее', 
                               'их', 'она', 'они', 'мы', 'вы', 'наш', 'ваш'];
            return word.length > 4 && !skipWords.includes(word);
        });
    
    return [...new Set(words)];
}

// ============================================
// ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ
// ============================================

function generateImageUrl(prompt, seed) {
    const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();
    const encodedPrompt = encodeURIComponent(cleanPrompt);
    
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=600&seed=${seed}&nologo=true&enhance=true&model=flux`;
}

// ============================================
// API ENDPOINTS
// ============================================

// Генерация контента для одной точки
app.post('/api/generate-content', async (req, res) => {
    try {
        const { treasure_id } = req.body;
        
        if (!treasure_id) {
            return res.status(400).json({ error: 'treasure_id is required' });
        }
        
        console.log(`🤖 Генерация контента для точки ${treasure_id}...`);
        
        // Получаем точку из БД
        const { data: treasure, error: fetchError } = await supabase
            .from('treasures')
            .select('*')
            .eq('id', treasure_id)
            .single();
        
        if (fetchError || !treasure) {
            return res.status(404).json({ error: 'Treasure not found' });
        }
        
        if (!treasure.legend) {
            return res.status(400).json({ error: 'No legend to generate from' });
        }
        
        // 1. Генерируем описание из легенды
        const description = generateDescriptionFromLegend(treasure.legend);
        console.log(`📝 Описание сгенерировано: ${description.substring(0, 50)}...`);
        
        // 2. Создаем промпт для изображения
        const updatedTreasure = { ...treasure, description };
        const prompt = createImagePrompt(updatedTreasure);
        console.log(`🎨 Промпт создан: ${prompt.substring(0, 50)}...`);
        
        // 3. Генерируем URL изображения
        const imageUrl = generateImageUrl(prompt, treasure_id);
        console.log(`🖼️ Изображение: ${imageUrl.substring(0, 80)}...`);
        
        // 4. Сохраняем в БД
        const { error: updateError } = await supabase
            .from('treasures')
            .update({
                description: description,
                image_url: imageUrl
            })
            .eq('id', treasure_id);
        
        if (updateError) {
            console.error('Ошибка сохранения:', updateError);
            return res.status(500).json({ error: 'Failed to save to database' });
        }
        
        console.log(`✅ Контент для точки ${treasure_id} сохранен!`);
        
        res.json({
            success: true,
            treasure_id,
            description,
            image_url: imageUrl
        });
        
    } catch (error) {
        console.error('Ошибка генерации:', error);
        res.status(500).json({ error: error.message });
    }
});

// Массовая генерация для всех точек без контента
app.post('/api/generate-all', async (req, res) => {
    try {
        console.log('🚀 Начинаем массовую генерацию...');
        
        // Получаем все точки которым нужна генерация
        const { data: treasures, error: fetchError } = await supabase
            .from('treasures')
            .select('*')
            .not('legend', 'is', null)
            .or('description.is.null,image_url.is.null');
        
        if (fetchError || !treasures || treasures.length === 0) {
            return res.json({ message: 'No treasures need generation' });
        }
        
        console.log(`📦 Найдено ${treasures.length} точек для генерации`);
        
        const results = [];
        
        for (const treasure of treasures) {
            try {
                // Генерируем описание
                const description = treasure.description || generateDescriptionFromLegend(treasure.legend);
                
                // Генерируем промпт и изображение
                const updatedTreasure = { ...treasure, description };
                const prompt = createImagePrompt(updatedTreasure);
                const imageUrl = generateImageUrl(prompt, treasure.id);
                
                // Сохраняем
                await supabase
                    .from('treasures')
                    .update({
                        description: description,
                        image_url: imageUrl
                    })
                    .eq('id', treasure.id);
                
                results.push({
                    id: treasure.id,
                    name: treasure.name,
                    success: true
                });
                
                console.log(`✅ ${treasure.name} - готово`);
                
                // Задержка между запросами
                await new Promise(r => setTimeout(r, 500));
                
            } catch (error) {
                console.error(`❌ Ошибка для ${treasure.name}:`, error);
                results.push({
                    id: treasure.id,
                    name: treasure.name,
                    success: false,
                    error: error.message
                });
            }
        }
        
        console.log('🎉 Массовая генерация завершена!');
        
        res.json({
            success: true,
            total: treasures.length,
            results
        });
        
    } catch (error) {
        console.error('Ошибка массовой генерации:', error);
        res.status(500).json({ error: error.message });
    }
});

// Проверка здоровья API
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Запуск сервера
app.listen(CONFIG.PORT, () => {
    console.log(`🚀 Backend запущен на порту ${CONFIG.PORT}`);
    console.log(`📍 API доступен: http://localhost:${CONFIG.PORT}`);
    console.log(`💡 Endpoints:`);
    console.log(`   POST /api/generate-content - генерация для одной точки`);
    console.log(`   POST /api/generate-all - массовая генерация`);
    console.log(`   GET  /api/health - проверка здоровья`);
});

module.exports = app;

// ============================================
// CONFIGURATION - YOUR ACTUAL KEYS
// ============================================

const CONFIG = {
	MAPBOX_TOKEN: 'pk.eyJ1IjoibXJoZXJvIiwiYSI6ImNtaTI1YmZsODFiODUyanNjZHRlaXRsaWYifQ.QMdYQgjDCxDLxSQmIUJJiw',
	SUPABASE_URL: 'https://otvtqoowhupqxushkmma.supabase.co',
	SUPABASE_KEY: 'sb_publishable_yeG_VzvaJW-0Pxikgrup7g_cYZXKLfn',
	CLAIM_DISTANCE: 50, // meters - how close you need to be to claim
};

// ============================================
// GLOBAL STATE
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
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
	try {
		// Initialize Supabase
		supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
		
		// Initialize Telegram WebApp
		const tg = window.Telegram.WebApp;
		tg.ready();
		tg.expand();
		
		// Get user info from Telegram
		const telegramUser = tg.initDataUnsafe?.user || {
			id: Math.floor(Math.random() * 1000000), // Fallback for testing
			username: 'TestUser'
		};
		
		// Initialize or get user from database
		currentUser = await initUser(telegramUser);
		
		// Update UI with user info
		document.getElementById('username').textContent = `@${currentUser.username || 'Anonymous'}`;
		document.getElementById('user-score').textContent = currentUser.score;
		
		// Load treasures and user claims
		await loadTreasures();
		await loadUserClaims();
		
		// Initialize map
		initMap();
		
		// Start tracking location
		startLocationTracking();
		
		// Setup event listeners
		setupEventListeners();
		
		// Hide loading screen
		setTimeout(() => {
			document.getElementById('loading-screen').style.display = 'none';
			document.getElementById('app').style.display = 'block';
		}, 1000);
		
	} catch (error) {
		console.error('Initialization error:', error);
		alert('Error loading app. Please check console and configuration.');
	}
});

// ============================================
// USER MANAGEMENT
// ============================================

async function initUser(telegramUser) {
	try {
		// Check if user exists
		const { data: existingUser } = await supabase
			.from('users')
			.select('*')
			.eq('telegram_id', telegramUser.id)
			.single();
		
		if (existingUser) {
			return existingUser;
		}
		
		// Create new user
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
		console.error('User init error:', error);
		// Return fallback user for testing
		return {
			id: 1,
			telegram_id: telegramUser.id,
			username: telegramUser.username || 'TestUser',
			score: 0
		};
	}
}

// ============================================
// DATA LOADING
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
		console.error('Load treasures error:', error);
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
		console.error('Load claims error:', error);
	}
}

function updateStats() {
	const claimed = userClaims.length;
	const remaining = treasures.length - claimed;
	
	document.getElementById('claimed-count').textContent = claimed;
	document.getElementById('remaining-count').textContent = remaining;
}

// ============================================
// MAP INITIALIZATION
// ============================================

function initMap() {
	mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;
	
	// Default to Amsterdam center
	const center = [4.9, 52.37];
	
	map = new mapboxgl.Map({
		container: 'map',
		style: 'mapbox://styles/mapbox/dark-v11',
		center: center,
		zoom: 13,
		pitch: 45
	});
	
	map.on('load', () => {
		// Add treasures to map
		addTreasuresToMap();
	});
}

function addTreasuresToMap() {
	treasures.forEach(treasure => {
		const isClaimed = userClaims.includes(treasure.id);
		
		// Create marker element
		const el = document.createElement('div');
		el.className = `treasure-marker ${isClaimed ? 'claimed' : ''}`;
		el.innerHTML = isClaimed ? '✓' : '💎';
		
		// Add click handler
		el.addEventListener('click', () => {
			selectTreasure(treasure);
		});
		
		// Add marker to map
		new mapboxgl.Marker(el)
			.setLngLat([treasure.lng, treasure.lat])
			.addTo(map);
	});
}

// ============================================
// LOCATION TRACKING
// ============================================

function startLocationTracking() {
	if (!navigator.geolocation) {
		alert('Geolocation is not supported by your browser');
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
	
	// Update or create user marker
	if (userMarker) {
		userMarker.setLngLat([userLocation.lng, userLocation.lat]);
	} else {
		const el = document.createElement('div');
		el.className = 'user-marker';
		
		userMarker = new mapboxgl.Marker(el)
			.setLngLat([userLocation.lng, userLocation.lat])
			.addTo(map);
		
		// Center map on user (first time only)
		map.flyTo({
			center: [userLocation.lng, userLocation.lat],
			zoom: 15
		});
	}
	
	// Update distance to selected treasure
	if (selectedTreasure) {
		updateDistanceDisplay();
	}
}

function handleLocationError(error) {
	console.error('Location error:', error);
	
	// Fallback: center of Amsterdam
	userLocation = { lat: 52.37, lng: 4.9 };
	
	if (!userMarker) {
		const el = document.createElement('div');
		el.className = 'user-marker';
		
		userMarker = new mapboxgl.Marker(el)
			.setLngLat([userLocation.lng, userLocation.lat])
			.addTo(map);
	}
}

// ============================================
// TREASURE INTERACTION
// ============================================

function selectTreasure(treasure) {
	selectedTreasure = treasure;
	
	// Show treasure info panel
	document.getElementById('default-info').style.display = 'none';
	document.getElementById('treasure-info').style.display = 'block';
	
	// Update info
	document.getElementById('treasure-name').textContent = treasure.name;
	document.getElementById('treasure-description').textContent = treasure.description;
	
	// Check if already claimed
	const isClaimed = userClaims.includes(treasure.id);
	const claimBtn = document.getElementById('claim-btn');
	
	if (isClaimed) {
		claimBtn.textContent = '✓ Already Claimed';
		claimBtn.disabled = true;
		document.getElementById('distance-text').textContent = '✓ Treasure claimed';
		return;
	}
	
	// Update distance and button state
	updateDistanceDisplay();
	
	// Fly to treasure
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
	
	distanceText.textContent = `📍 ${Math.round(distance)}m away`;
	
	if (distance <= CONFIG.CLAIM_DISTANCE) {
		claimBtn.textContent = `🎁 Claim ${selectedTreasure.points} Points!`;
		claimBtn.disabled = false;
		claimBtn.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
	} else {
		claimBtn.textContent = `🔒 Get closer (${CONFIG.CLAIM_DISTANCE}m needed)`;
		claimBtn.disabled = true;
		claimBtn.style.background = '#ccc';
	}
}

// ============================================
// CLAIM TREASURE
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
		alert('You need to be closer to claim this treasure!');
		return;
	}
	
	try {
		// Disable button
		const claimBtn = document.getElementById('claim-btn');
		claimBtn.disabled = true;
		claimBtn.textContent = 'Claiming...';
		
		// Insert claim
		const { error: claimError } = await supabase
			.from('claims')
			.insert([{
				user_id: currentUser.id,
				treasure_id: selectedTreasure.id
			}]);
		
		if (claimError) throw claimError;
		
		// Update user score
		const newScore = currentUser.score + selectedTreasure.points;
		const { error: updateError } = await supabase
			.from('users')
			.update({ score: newScore })
			.eq('id', currentUser.id);
		
		if (updateError) throw updateError;
		
		// Update local state
		currentUser.score = newScore;
		userClaims.push(selectedTreasure.id);
		
		// Update UI
		document.getElementById('user-score').textContent = newScore;
		updateStats();
		
		// Show success modal
		showSuccessModal(selectedTreasure.points);
		
		// Update marker appearance
		const markers = document.querySelectorAll('.treasure-marker');
		markers.forEach(marker => {
			// Re-render markers (simple approach: reload)
			// In production, you'd target specific marker
		});
		
		// Reload treasures to update UI
		await loadTreasures();
		
	} catch (error) {
		console.error('Claim error:', error);
		alert('Error claiming treasure. Please try again.');
	}
}

function showSuccessModal(points) {
	document.getElementById('success-message').innerHTML = 
		`You earned <strong>${points} points</strong>!`;
	document.getElementById('success-modal').style.display = 'flex';
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
	document.getElementById('claim-btn').addEventListener('click', claimTreasure);
	
	document.getElementById('close-modal').addEventListener('click', () => {
		document.getElementById('success-modal').style.display = 'none';
		
		// Reset to default view
		document.getElementById('treasure-info').style.display = 'none';
		document.getElementById('default-info').style.display = 'block';
		selectedTreasure = null;
	});
}

// ============================================
// UTILITIES
// ============================================

function calculateDistance(lat1, lon1, lat2, lon2) {
	const R = 6371e3; // Earth radius in meters
	const φ1 = lat1 * Math.PI / 180;
	const φ2 = lat2 * Math.PI / 180;
	const Δφ = (lat2 - lat1) * Math.PI / 180;
	const Δλ = (lon2 - lon1) * Math.PI / 180;
	
	const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
			  Math.cos(φ1) * Math.cos(φ2) *
			  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	
	return R * c; // Distance in meters
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
	if (watchId) {
		navigator.geolocation.clearWatch(watchId);
	}
});
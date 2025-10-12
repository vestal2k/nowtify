// popup.js - Gestion de l'interface utilisateur de la popup

// Éléments du DOM
const streamerInput = document.getElementById('streamerInput');
const addBtn = document.getElementById('addBtn');
const settingsBtn = document.getElementById('settingsBtn');
const streamersList = document.getElementById('streamersList');
const emptyState = document.getElementById('emptyState');
const errorMessage = document.getElementById('errorMessage');
const loadingState = document.getElementById('loadingState');

// Initialisation au chargement de la popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadStreamers();
  setupEventListeners();
});

// Configuration des écouteurs d'événements
function setupEventListeners() {
  addBtn.addEventListener('click', handleAddStreamer);
  streamerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddStreamer();
  });
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// Charger et afficher tous les streamers
async function loadStreamers() {
  try {
    showLoading(true);
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    
    if (streamers.length === 0) {
      showEmptyState(true);
      showLoading(false);
      return;
    }

    showEmptyState(false);
    streamersList.innerHTML = '';

    // Récupérer les données des streamers depuis le background
    chrome.runtime.sendMessage({ action: 'getStreamersData' }, (response) => {
      showLoading(false);
      
      if (response && response.streamers) {
        response.streamers.forEach(streamer => {
          renderStreamerCard(streamer);
        });
      } else {
        // Afficher les streamers basiques si pas de données
        streamers.forEach(streamer => {
          renderStreamerCard(streamer);
        });
      }
    });
  } catch (error) {
    console.error('Erreur lors du chargement des streamers:', error);
    showError('Erreur lors du chargement des streamers');
    showLoading(false);
  }
}

// Afficher une carte de streamer
function renderStreamerCard(streamer) {
  const card = document.createElement('div');
  card.className = `streamer-card ${streamer.isLive ? 'live' : ''}`;
  
  const statusText = getStatusText(streamer);
  const statusClass = streamer.isLive ? 'live' : (streamer.wasLiveRecently ? 'recent' : 'offline');
  
  card.innerHTML = `
    <img 
      src="${streamer.avatar || 'icons/icon48.png'}" 
      alt="${streamer.name}" 
      class="streamer-avatar"
      onerror="this.src='icons/icon48.png'"
    >
    <div class="streamer-info">
      <div class="streamer-name">${escapeHtml(streamer.name)}</div>
      <div class="streamer-meta">
        <span class="platform-badge platform-${streamer.platform}">${streamer.platform}</span>
        <span class="status-indicator">
          <span class="status-dot ${statusClass}"></span>
          ${statusText}
        </span>
      </div>
    </div>
    <button class="delete-btn" data-id="${streamer.id}" title="Supprimer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

  // Ouvrir le stream au clic sur la carte
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.delete-btn')) {
      openStream(streamer);
    }
  });

  // Supprimer le streamer
  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteStreamer(streamer.id);
  });

  streamersList.appendChild(card);
}

// Obtenir le texte de statut
function getStatusText(streamer) {
  if (streamer.isLive) {
    return streamer.viewerCount ? `🟢 Live - ${formatViewers(streamer.viewerCount)} viewers` : '🟢 Live';
  }
  if (streamer.wasLiveRecently) {
    const hours = Math.floor((Date.now() - streamer.lastLiveDate) / (1000 * 60 * 60));
    return `🔴 Live il y a ${hours}h`;
  }
  return '⚪ Offline';
}

// Formater le nombre de viewers
function formatViewers(count) {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}

// Gérer l'ajout d'un streamer
async function handleAddStreamer() {
  const input = streamerInput.value.trim();
  
  if (!input) {
    showError('Veuillez entrer une URL ou un nom de streamer');
    return;
  }

  try {
    addBtn.disabled = true;
    addBtn.textContent = 'Ajout...';

    // Détecter la plateforme et extraire l'identifiant
    const streamerData = parseStreamerInput(input);
    
    if (!streamerData) {
      showError('URL ou format non reconnu. Exemples: twitch.tv/username, youtube.com/@username, kick.com/username');
      return;
    }

    // Ajouter le streamer
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    
    // Vérifier si déjà ajouté
    const exists = streamers.some(s => 
      s.platform === streamerData.platform && s.username === streamerData.username
    );
    
    if (exists) {
      showError('Ce streamer est déjà dans votre liste');
      return;
    }

    const newStreamer = {
      id: Date.now().toString(),
      name: streamerData.username,
      username: streamerData.username,
      platform: streamerData.platform,
      avatar: '',
      isLive: false,
      wasLiveRecently: false,
      addedDate: Date.now()
    };

    streamers.push(newStreamer);
    await chrome.storage.sync.set({ streamers });

    // Recharger la liste
    streamerInput.value = '';
    hideError();
    await loadStreamers();

    // Déclencher une vérification immédiate
    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    console.error('Erreur lors de l\'ajout:', error);
    showError('Erreur lors de l\'ajout du streamer');
  } finally {
    addBtn.disabled = false;
    addBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      Ajouter
    `;
  }
}

// Parser l'input pour détecter la plateforme
function parseStreamerInput(input) {
  input = input.trim().toLowerCase();

  // Twitch
  if (input.includes('twitch.tv/')) {
    const match = input.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
    if (match) return { platform: 'twitch', username: match[1] };
  } else if (input.includes('twitch')) {
    const username = input.replace(/[^a-zA-Z0-9_]/g, '');
    if (username) return { platform: 'twitch', username };
  }

  // YouTube
  if (input.includes('youtube.com/') || input.includes('youtu.be/')) {
    const match = input.match(/youtube\.com\/@([a-zA-Z0-9_-]+)|youtube\.com\/channel\/([a-zA-Z0-9_-]+)|youtube\.com\/c\/([a-zA-Z0-9_-]+)/);
    if (match) {
      const username = match[1] || match[2] || match[3];
      return { platform: 'youtube', username };
    }
  } else if (input.includes('youtube') || input.includes('yt')) {
    const username = input.replace(/[^a-zA-Z0-9_-]/g, '');
    if (username) return { platform: 'youtube', username };
  }

  // Kick
  if (input.includes('kick.com/')) {
    const match = input.match(/kick\.com\/([a-zA-Z0-9_-]+)/);
    if (match) return { platform: 'kick', username: match[1] };
  } else if (input.includes('kick')) {
    const username = input.replace(/[^a-zA-Z0-9_-]/g, '');
    if (username) return { platform: 'kick', username };
  }

  // Par défaut, supposer Twitch si c'est juste un nom
  if (/^[a-zA-Z0-9_]+$/.test(input)) {
    return { platform: 'twitch', username: input };
  }

  return null;
}

// Supprimer un streamer
async function deleteStreamer(id) {
  if (!confirm('Êtes-vous sûr de vouloir supprimer ce streamer ?')) {
    return;
  }

  try {
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    const filtered = streamers.filter(s => s.id !== id);
    await chrome.storage.sync.set({ streamers: filtered });
    await loadStreamers();
  } catch (error) {
    console.error('Erreur lors de la suppression:', error);
    showError('Erreur lors de la suppression');
  }
}

// Ouvrir le stream
function openStream(streamer) {
  let url;
  switch (streamer.platform) {
    case 'twitch':
      url = `https://twitch.tv/${streamer.username}`;
      break;
    case 'youtube':
      url = `https://youtube.com/@${streamer.username}/live`;
      break;
    case 'kick':
      url = `https://kick.com/${streamer.username}`;
      break;
  }
  
  if (url) {
    chrome.tabs.create({ url });
  }
}

// Afficher/masquer l'état vide
function showEmptyState(show) {
  emptyState.classList.toggle('hidden', !show);
  streamersList.style.display = show ? 'none' : 'flex';
}

// Afficher/masquer le chargement
function showLoading(show) {
  loadingState.style.display = show ? 'block' : 'none';
  streamersList.style.display = show ? 'none' : 'flex';
}

// Afficher une erreur
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  setTimeout(() => hideError(), 5000);
}

// Masquer l'erreur
function hideError() {
  errorMessage.classList.remove('show');
}

// Échapper le HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
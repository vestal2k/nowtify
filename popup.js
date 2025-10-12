// popup.js - Gestion de l'interface utilisateur de la popup

// Éléments du DOM
const streamerInput = document.getElementById('streamerInput');
const addBtn = document.getElementById('addBtn');
const settingsBtn = document.getElementById('settingsBtn');
const streamersList = document.getElementById('streamersList');
const emptyState = document.getElementById('emptyState');
const errorMessage = document.getElementById('errorMessage');
const loadingState = document.getElementById('loadingState');

// Variables pour l'auto-complétion
let autocompleteTimeout = null;
let autocompleteList = null;

// Initialisation au chargement de la popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadStreamers();
  setupEventListeners();
  createAutocompleteList();
});

// Configuration des écouteurs d'événements
function setupEventListeners() {
  addBtn.addEventListener('click', handleAddStreamer);
  streamerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      hideAutocomplete();
      handleAddStreamer();
    }
  });
  
  // Auto-complétion
  streamerInput.addEventListener('input', handleAutocomplete);
  streamerInput.addEventListener('focus', handleAutocomplete);
  streamerInput.addEventListener('blur', () => {
    setTimeout(() => hideAutocomplete(), 250);
  });
  
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// Créer l'élément d'auto-complétion
function createAutocompleteList() {
  autocompleteList = document.createElement('div');
  autocompleteList.className = 'autocomplete-list';
  autocompleteList.style.display = 'none';
  document.querySelector('.add-section').appendChild(autocompleteList);
}

// Gérer l'auto-complétion
function handleAutocomplete(e) {
  const query = streamerInput.value.trim();
  
  clearTimeout(autocompleteTimeout);
  
  if (query.length < 2) {
    hideAutocomplete();
    return;
  }

  // Délai de 300ms avant la recherche
  autocompleteTimeout = setTimeout(() => {
    chrome.runtime.sendMessage(
      { action: 'searchStreamers', query: query },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Erreur recherche:', chrome.runtime.lastError);
          return;
        }
        
        if (response && response.results && response.results.length > 0) {
          showAutocomplete(response.results);
        } else {
          hideAutocomplete();
        }
      }
    );
  }, 300);
}

// Afficher les résultats d'auto-complétion
function showAutocomplete(results) {
  autocompleteList.innerHTML = '';
  autocompleteList.style.display = 'block';

  results.forEach(result => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    
    const platformIcon = getPlatformIcon(result.platform);
    
    item.innerHTML = `
      <img 
        src="${result.avatar || 'icons/icon48.png'}" 
        alt="${result.name}"
        class="autocomplete-avatar"
        onerror="this.src='icons/icon48.png'"
      >
      <div class="autocomplete-info">
        <div class="autocomplete-name">${escapeHtml(result.name)}</div>
        <div class="autocomplete-meta">
          <span class="platform-badge platform-${result.platform}">
            ${platformIcon}
            ${result.platform}
          </span>
          ${result.isLive ? '<span class="live-badge">🔴 Live</span>' : ''}
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      addStreamerFromAutocomplete(result);
    });

    autocompleteList.appendChild(item);
  });
}

// Obtenir l'icône de plateforme
function getPlatformIcon(platform) {
  const icons = {
    twitch: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7"></path></svg>',
    youtube: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>',
    kick: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>'
  };
  return icons[platform] || '';
}

// Ajouter un streamer depuis l'auto-complétion
async function addStreamerFromAutocomplete(result) {
  hideAutocomplete();
  streamerInput.value = '';
  
  try {
    addBtn.disabled = true;
    addBtn.textContent = '➕ Ajout...';

    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    
    // Vérifier si déjà ajouté
    const exists = streamers.some(s => 
      s.platform === result.platform && s.username === result.username
    );
    
    if (exists) {
      showError('Ce streamer est déjà dans votre liste');
      return;
    }

    const newStreamer = {
      id: Date.now().toString(),
      name: result.name,
      username: result.username,
      platform: result.platform,
      avatar: result.avatar || '',
      isLive: result.isLive || false,
      wasLiveRecently: false,
      addedDate: Date.now()
    };

    streamers.push(newStreamer);
    await chrome.storage.sync.set({ streamers });

    hideError();
    await loadStreamers();

    // Déclencher une vérification immédiate
    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    console.error('Erreur lors de l\'ajout:', error);
    showError('Erreur lors de l\'ajout du streamer');
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = '➕ Ajouter';
  }
}

// Masquer l'auto-complétion
function hideAutocomplete() {
  if (autocompleteList) {
    autocompleteList.style.display = 'none';
  }
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
  card.style.opacity = '0';
  card.style.transform = 'translateX(-20px)';
  
  const statusText = getStatusText(streamer);
  const statusClass = streamer.isLive ? 'live' : (streamer.wasLiveRecently ? 'recent' : 'offline');
  
  // Emoji de plateforme
  const platformEmoji = streamer.platform === 'twitch' ? '💜' : 
                       streamer.platform === 'youtube' ? '❤️' : '💚';
  
  // Avatar avec fallback
  const avatarUrl = streamer.avatar && streamer.avatar !== '' ? streamer.avatar : 'icons/icon48.png';
  
  card.innerHTML = `
    <div style="font-size: 20px; margin-right: -4px;">${platformEmoji}</div>
    <img 
      src="${avatarUrl}" 
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
      ${streamer.title ? `<div class="streamer-title">${escapeHtml(streamer.title)}</div>` : ''}
    </div>
    <button class="delete-btn" data-id="${streamer.id}" title="Supprimer">
      ❌
    </button>
  `;

  // Animation d'entrée
  setTimeout(() => {
    card.style.transition = 'all 0.3s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateX(0)';
  }, 50);

  // Ouvrir le stream au clic sur la carte
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.delete-btn')) {
      openStream(streamer);
    }
  });

  // Supprimer le streamer
  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteStreamer(streamer.id, card);
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

// Supprimer un streamer (SANS CONFIRMATION)
async function deleteStreamer(id, cardElement) {
  try {
    // Animation de sortie
    cardElement.style.transition = 'all 0.3s ease';
    cardElement.style.opacity = '0';
    cardElement.style.transform = 'translateX(20px)';
    
    setTimeout(async () => {
      const { streamers = [] } = await chrome.storage.sync.get('streamers');
      const filtered = streamers.filter(s => s.id !== id);
      await chrome.storage.sync.set({ streamers: filtered });
      await loadStreamers();
    }, 300);
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
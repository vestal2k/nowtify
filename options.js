const notificationsEnabled = document.getElementById('notificationsEnabled');
const notificationSound = document.getElementById('notificationSound');
const persistentNotifications = document.getElementById('persistentNotifications');
const autoRefresh = document.getElementById('autoRefresh');
const refreshInterval = document.getElementById('refreshInterval');
const twitchClientId = document.getElementById('twitchClientId');
const twitchClientSecret = document.getElementById('twitchClientSecret');
const youtubeApiKey = document.getElementById('youtubeApiKey');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const saveBtn = document.getElementById('saveBtn');
const saveMessage = document.getElementById('saveMessage');

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadHistory();
  setupEventListeners();
});

function setupEventListeners() {
  saveBtn.addEventListener('click', saveSettings);
  clearHistoryBtn.addEventListener('click', clearHistory);

  [notificationsEnabled, notificationSound, persistentNotifications, autoRefresh].forEach(toggle => {
    toggle.addEventListener('change', () => {
      saveSettings(false);
    });
  });

  refreshInterval.addEventListener('change', () => {
    saveSettings(false);
    updateAlarm();
  });
}

async function loadSettings() {
  try {
    const { settings = {}, apiKeys = {} } = await chrome.storage.sync.get(['settings', 'apiKeys']);

    notificationsEnabled.checked = settings.notifications !== false;
    notificationSound.checked = settings.notificationSound === true;
    persistentNotifications.checked = settings.persistentNotifications === true;

    autoRefresh.checked = settings.autoRefresh !== false;
    refreshInterval.value = settings.refreshInterval || '5';

    twitchClientId.value = apiKeys.twitchClientId || '';
    twitchClientSecret.value = apiKeys.twitchClientSecret || '';
    youtubeApiKey.value = apiKeys.youtubeApiKey || '';

  } catch (error) {
    console.error('Erreur lors du chargement des paramètres:', error);
  }
}

async function saveSettings(showMessage = true) {
  try {
    const settings = {
      notifications: notificationsEnabled.checked,
      notificationSound: notificationSound.checked,
      persistentNotifications: persistentNotifications.checked,
      autoRefresh: autoRefresh.checked,
      refreshInterval: refreshInterval.value
    };

    const apiKeys = {
      twitchClientId: twitchClientId.value.trim(),
      twitchClientSecret: twitchClientSecret.value.trim(),
      youtubeApiKey: youtubeApiKey.value.trim()
    };

    await chrome.storage.sync.set({ settings, apiKeys });

    chrome.runtime.sendMessage({ 
      action: 'settingsUpdated',
      settings,
      apiKeys
    });

    if (showMessage) {
      saveMessage.classList.add('show');
      setTimeout(() => {
        saveMessage.classList.remove('show');
      }, 2000);
    }

  } catch (error) {
    console.error('Erreur lors de la sauvegarde:', error);
    alert('Erreur lors de la sauvegarde des paramètres');
  }
}

function updateAlarm() {
  const minutes = parseInt(refreshInterval.value);
  chrome.runtime.sendMessage({
    action: 'updateAlarm',
    minutes
  });
}

async function loadHistory() {
  try {
    const { history = [] } = await chrome.storage.local.get('history');

    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="empty-history">
          <p>Aucun historique pour le moment</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = '';
    
    // Afficher les 10 derniers
    const recentHistory = history.slice(0, 10);

    recentHistory.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';

      const timeAgo = getTimeAgo(item.timestamp);
      const platformClass = `platform-${item.platform}`;

      historyItem.innerHTML = `
        <div class="history-info">
          <div class="history-name">${escapeHtml(item.name)}</div>
          <div class="history-meta">
            <span class="history-platform ${platformClass}">${item.platform}</span>
            ${item.title ? ` • ${escapeHtml(item.title)}` : ''}
          </div>
        </div>
        <div style="color: rgba(232, 232, 232, 0.5); font-size: 12px;">
          ${timeAgo}
        </div>
      `;

      historyList.appendChild(historyItem);
    });

  } catch (error) {
    console.error('Erreur lors du chargement de l\'historique:', error);
    historyList.innerHTML = `
      <div class="empty-history">
        <p>Erreur lors du chargement de l'historique</p>
      </div>
    `;
  }
}

async function clearHistory() {
  if (!confirm('Êtes-vous sûr de vouloir effacer tout l\'historique ?')) {
    return;
  }

  try {
    await chrome.storage.local.set({ history: [] });
    await loadHistory();
  } catch (error) {
    console.error('Erreur lors de l\'effacement:', error);
    alert('Erreur lors de l\'effacement de l\'historique');
  }
}

function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'À l\'instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  if (hours < 24) return `Il y a ${hours}h`;
  if (days < 7) return `Il y a ${days}j`;
  
  const date = new Date(timestamp);
  return date.toLocaleDateString('fr-FR', { 
    day: 'numeric', 
    month: 'short' 
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'historyUpdated') {
    loadHistory();
  }
});
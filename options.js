const notificationsEnabled = document.getElementById('notificationsEnabled');
const notificationSound = document.getElementById('notificationSound');
const persistentNotifications = document.getElementById('persistentNotifications');
const confirmDelete = document.getElementById('confirmDelete');
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
  await loadTeamsManagement();
  await loadHistory();
  setupEventListeners();
});

function setupEventListeners() {
  saveBtn.addEventListener('click', saveSettings);
  clearHistoryBtn.addEventListener('click', clearHistory);

  [notificationsEnabled, notificationSound, persistentNotifications, confirmDelete, autoRefresh].forEach(toggle => {
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
    confirmDelete.checked = settings.confirmDelete !== false;

    autoRefresh.checked = settings.autoRefresh !== false;
    refreshInterval.value = settings.refreshInterval || '5';

    twitchClientId.value = apiKeys.twitchClientId || '';
    twitchClientSecret.value = apiKeys.twitchClientSecret || '';
    youtubeApiKey.value = apiKeys.youtubeApiKey || '';

  } catch (error) {
  }
}

async function saveSettings(showMessage = true) {
  try {
    const settings = {
      notifications: notificationsEnabled.checked,
      notificationSound: notificationSound.checked,
      persistentNotifications: persistentNotifications.checked,
      confirmDelete: confirmDelete.checked,
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

async function loadTeamsManagement() {
  try {
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    const teamsMap = {};
    
    streamers.forEach(streamer => {
      if (streamer.team) {
        if (!teamsMap[streamer.team]) {
          teamsMap[streamer.team] = [];
        }
        teamsMap[streamer.team].push(streamer);
      }
    });

    const teamsManagement = document.getElementById('teamsManagement');
    
    if (Object.keys(teamsMap).length === 0) {
      teamsManagement.innerHTML = '<p style="color: rgba(232, 232, 232, 0.5); padding: 20px; text-align: center;">Aucune team ajoutée</p>';
      return;
    }

    teamsManagement.innerHTML = '';
    
    Object.keys(teamsMap).sort().forEach(teamName => {
      const members = teamsMap[teamName];
      const teamCard = document.createElement('div');
      teamCard.className = 'team-card';
      teamCard.style.cssText = 'background: rgba(30, 30, 40, 0.6); border-radius: 8px; padding: 16px; margin-bottom: 12px;';
      
      const teamHeader = document.createElement('div');
      teamHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
      teamHeader.innerHTML = `
        <h3 style="margin: 0; font-size: 16px; color: rgba(92, 255, 224, 0.9);">${capitalizeTeamName(teamName)} (${members.length})</h3>
        <button class="btn-danger-small" data-team="${teamName}" style="padding: 6px 12px; font-size: 12px; background: rgba(255, 82, 82, 0.2); color: #ff5252; border: 1px solid rgba(255, 82, 82, 0.3); border-radius: 6px; cursor: pointer;">
          Supprimer la team
        </button>
      `;
      
      const membersList = document.createElement('div');
      membersList.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;';
      
      members.forEach(member => {
        const memberItem = document.createElement('div');
        memberItem.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: rgba(20, 20, 30, 0.4); border-radius: 6px;';
        memberItem.innerHTML = `
          <span style="font-size: 13px; color: rgba(232, 232, 232, 0.9);">${escapeHtml(member.name)}</span>
          <button class="delete-member-btn" data-id="${member.id}" style="background: none; border: none; color: rgba(255, 82, 82, 0.6); cursor: pointer; padding: 4px; font-size: 16px;">×</button>
        `;
        membersList.appendChild(memberItem);
      });
      
      teamCard.appendChild(teamHeader);
      teamCard.appendChild(membersList);
      teamsManagement.appendChild(teamCard);
    });

    document.querySelectorAll('.btn-danger-small').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const teamName = e.target.dataset.team;
        if (confirm(`Supprimer tous les membres de ${teamName} ?`)) {
          await deleteTeamFromSettings(teamName);
        }
      });
    });

    document.querySelectorAll('.delete-member-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const streamerId = e.target.dataset.id;
        await deleteMemberFromSettings(streamerId);
      });
    });

  } catch (error) {}
}

async function deleteTeamFromSettings(teamName) {
  try {
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    const filtered = streamers.filter(s => s.team !== teamName);
    await chrome.storage.sync.set({ streamers: filtered });
    await chrome.storage.local.remove(`teamLogo_${teamName.toLowerCase()}`);
    await loadTeamsManagement();
  } catch (error) {}
}

async function deleteMemberFromSettings(streamerId) {
  try {
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    const filtered = streamers.filter(s => s.id !== streamerId);
    await chrome.storage.sync.set({ streamers: filtered });
    await chrome.storage.local.remove(`avatar_${streamerId}`);
    await loadTeamsManagement();
  } catch (error) {}
}

function capitalizeTeamName(teamName) {
  return teamName.charAt(0).toUpperCase() + teamName.slice(1).toLowerCase();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'historyUpdated') {
    loadHistory();
  }
});
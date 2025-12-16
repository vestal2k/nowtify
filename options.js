const notificationsEnabled = document.getElementById('notificationsEnabled');
const notificationSound = document.getElementById('notificationSound');
const notificationSoundType = document.getElementById('notificationSoundType');
const soundSelectContainer = document.getElementById('soundSelectContainer');
const playSoundBtn = document.getElementById('playSoundBtn');
const persistentNotifications = document.getElementById('persistentNotifications');
const confirmDelete = document.getElementById('confirmDelete');
const refreshInterval = document.getElementById('refreshInterval');
const twitchClientId = document.getElementById('twitchClientId');
const twitchClientSecret = document.getElementById('twitchClientSecret');
const youtubeApiKey = document.getElementById('youtubeApiKey');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const saveBtn = document.getElementById('saveBtn');
const saveMessage = document.getElementById('saveMessage');
const newGroupName = document.getElementById('newGroupName');
const addGroupBtn = document.getElementById('addGroupBtn');
const groupsList = document.getElementById('groupsList');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

// Group colors palette
const GROUP_COLORS = [
  '#5CFFE0', '#7B5CFF', '#FF4F8B', '#FF3366', '#10B981',
  '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#06B6D4'
];

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadGroups();
  await loadTeamsManagement();
  await loadHistory();
  setupEventListeners();
  setupMouseFollowEffect();
});

function setupMouseFollowEffect() {
  document.querySelectorAll('.section').forEach(section => {
    section.addEventListener('mousemove', (e) => {
      const rect = section.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      section.style.setProperty('--mouse-x', x + '%');
      section.style.setProperty('--mouse-y', y + '%');
    });
  });
}

function setupEventListeners() {
  saveBtn.addEventListener('click', saveSettings);
  clearHistoryBtn.addEventListener('click', clearHistory);

  [notificationsEnabled, persistentNotifications, confirmDelete].forEach(toggle => {
    toggle.addEventListener('change', () => {
      saveSettings(false);
    });
  });

  // Sound toggle with visibility control
  notificationSound.addEventListener('change', () => {
    soundSelectContainer.style.display = notificationSound.checked ? 'flex' : 'none';
    saveSettings(false);
  });

  notificationSoundType.addEventListener('change', () => {
    saveSettings(false);
  });

  playSoundBtn.addEventListener('click', () => {
    playNotificationSound(notificationSoundType.value);
  });

  refreshInterval.addEventListener('change', () => {
    saveSettings(false);
    updateAlarm();
  });

  // Groups
  addGroupBtn.addEventListener('click', addGroup);
  newGroupName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addGroup();
  });

  // Export/Import
  exportBtn.addEventListener('click', exportData);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importData);
}

async function loadSettings() {
  try {
    const { settings = {}, apiKeys = {} } = await chrome.storage.sync.get(['settings', 'apiKeys']);

    notificationsEnabled.checked = settings.notifications !== false;
    notificationSound.checked = settings.notificationSound === true;
    notificationSoundType.value = settings.notificationSoundType || 'default';
    soundSelectContainer.style.display = settings.notificationSound ? 'flex' : 'none';
    persistentNotifications.checked = settings.persistentNotifications === true;
    confirmDelete.checked = settings.confirmDelete !== false;
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
      notificationSoundType: notificationSoundType.value,
      persistentNotifications: persistentNotifications.checked,
      confirmDelete: confirmDelete.checked,
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

      // Format duration if available
      let durationText = '';
      if (item.duration) {
        const hours = Math.floor(item.duration / 3600000);
        const minutes = Math.floor((item.duration % 3600000) / 60000);
        if (hours > 0) {
          durationText = `${hours}h${minutes > 0 ? minutes + 'min' : ''}`;
        } else {
          durationText = `${minutes}min`;
        }
      }

      historyItem.innerHTML = `
        <div class="history-info">
          <div class="history-name">${escapeHtml(item.name)}</div>
          <div class="history-meta">
            <span class="history-platform ${platformClass}">${item.platform}</span>
            ${item.title ? ` • ${escapeHtml(item.title)}` : ''}
          </div>
          ${item.game || durationText ? `
            <div class="history-details">
              ${item.game ? `<span class="history-game"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 13h4m-2-2v4m3 1h.01M17 16h.01M2 12V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z"/></svg>${escapeHtml(item.game)}</span>` : ''}
              ${item.game && durationText ? '<span class="history-separator">•</span>' : ''}
              ${durationText ? `<span class="history-duration"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>${durationText}</span>` : ''}
            </div>
          ` : ''}
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

// ============================================
// Groups Management
// ============================================

async function loadGroups() {
  try {
    const { groups = [], streamers = [] } = await chrome.storage.sync.get(['groups', 'streamers']);

    if (groups.length === 0) {
      groupsList.innerHTML = '<div class="empty-groups">Aucun groupe créé</div>';
      return;
    }

    groupsList.innerHTML = '';

    groups.forEach((group, index) => {
      const memberCount = streamers.filter(s => s.group === group.id).length;
      const groupItem = document.createElement('div');
      groupItem.className = 'group-item';
      groupItem.innerHTML = `
        <div class="group-info">
          <span class="group-color" style="background: ${group.color}"></span>
          <span class="group-name">${escapeHtml(group.name)}</span>
          <span class="group-count">(${memberCount} streamer${memberCount > 1 ? 's' : ''})</span>
        </div>
        <div class="group-actions">
          <button class="btn-group-action delete" data-group-id="${group.id}" title="Supprimer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;
      groupsList.appendChild(groupItem);
    });

    // Add delete event listeners
    document.querySelectorAll('.btn-group-action.delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const groupId = e.currentTarget.dataset.groupId;
        await deleteGroup(groupId);
      });
    });

  } catch (error) {
    groupsList.innerHTML = '<div class="empty-groups">Erreur lors du chargement</div>';
  }
}

async function addGroup() {
  const name = newGroupName.value.trim();
  if (!name) return;

  try {
    const { groups = [] } = await chrome.storage.sync.get('groups');

    // Check if group already exists
    if (groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      alert('Un groupe avec ce nom existe déjà');
      return;
    }

    const newGroup = {
      id: `group_${Date.now()}`,
      name: name,
      color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
      createdAt: Date.now()
    };

    groups.push(newGroup);
    await chrome.storage.sync.set({ groups });

    newGroupName.value = '';
    await loadGroups();

  } catch (error) {
    alert('Erreur lors de la création du groupe');
  }
}

async function deleteGroup(groupId) {
  if (!confirm('Supprimer ce groupe ? Les streamers ne seront pas supprimés.')) {
    return;
  }

  try {
    const { groups = [], streamers = [] } = await chrome.storage.sync.get(['groups', 'streamers']);

    // Remove group from list
    const filteredGroups = groups.filter(g => g.id !== groupId);

    // Remove group assignment from streamers
    const updatedStreamers = streamers.map(s => {
      if (s.group === groupId) {
        const { group, ...rest } = s;
        return rest;
      }
      return s;
    });

    await chrome.storage.sync.set({ groups: filteredGroups, streamers: updatedStreamers });
    await loadGroups();

  } catch (error) {
    alert('Erreur lors de la suppression du groupe');
  }
}

// ============================================
// Export/Import
// ============================================

async function exportData() {
  try {
    const { streamers = [], groups = [], settings = {} } = await chrome.storage.sync.get(['streamers', 'groups', 'settings']);
    const { history = [] } = await chrome.storage.local.get('history');

    const exportObj = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      data: {
        streamers,
        groups,
        settings,
        history
      }
    };

    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `nowtify-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSaveMessage('Export réussi !');

  } catch (error) {
    alert('Erreur lors de l\'export');
  }
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importObj = JSON.parse(text);

    if (!importObj.data) {
      alert('Format de fichier invalide');
      return;
    }

    const { streamers: currentStreamers = [], groups: currentGroups = [] } = await chrome.storage.sync.get(['streamers', 'groups']);
    const { history: currentHistory = [] } = await chrome.storage.local.get('history');

    // Merge streamers (avoid duplicates by platform + username)
    const importedStreamers = importObj.data.streamers || [];
    const mergedStreamers = [...currentStreamers];

    importedStreamers.forEach(imported => {
      const exists = mergedStreamers.some(s =>
        s.platform === imported.platform &&
        s.username.toLowerCase() === imported.username.toLowerCase()
      );
      if (!exists) {
        mergedStreamers.push({ ...imported, id: `${imported.platform}_${imported.username}_${Date.now()}` });
      }
    });

    // Merge groups (avoid duplicates by name)
    const importedGroups = importObj.data.groups || [];
    const mergedGroups = [...currentGroups];

    importedGroups.forEach(imported => {
      const exists = mergedGroups.some(g => g.name.toLowerCase() === imported.name.toLowerCase());
      if (!exists) {
        mergedGroups.push({ ...imported, id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` });
      }
    });

    // Merge history (keep most recent, limit to 50)
    const importedHistory = importObj.data.history || [];
    const mergedHistory = [...currentHistory, ...importedHistory]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);

    await chrome.storage.sync.set({
      streamers: mergedStreamers,
      groups: mergedGroups
    });

    await chrome.storage.local.set({ history: mergedHistory });

    // Reload everything
    await loadGroups();
    await loadHistory();
    await loadTeamsManagement();

    showSaveMessage(`Import réussi ! ${importedStreamers.length} streamer(s) traités.`);

    // Reset file input
    importFile.value = '';

    // Trigger refresh
    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    alert('Erreur lors de l\'import : ' + error.message);
    importFile.value = '';
  }
}

function showSaveMessage(text) {
  saveMessage.textContent = text;
  saveMessage.classList.add('show');
  setTimeout(() => {
    saveMessage.classList.remove('show');
  }, 2000);
}

// ============================================
// Sound Management
// ============================================

function playNotificationSound(soundType) {
  // Generate sounds using Web Audio API
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  const sounds = {
    default: () => playTone(audioContext, [440, 550, 660], 0.15, 'sine'),
    chime: () => playTone(audioContext, [523, 659, 784, 1047], 0.2, 'sine'),
    bell: () => playTone(audioContext, [880, 1100], 0.3, 'triangle'),
    pop: () => playPop(audioContext),
    ding: () => playTone(audioContext, [1000], 0.15, 'sine')
  };

  if (sounds[soundType]) {
    sounds[soundType]();
  }
}

function playTone(audioContext, frequencies, duration, type) {
  frequencies.forEach((freq, i) => {
    setTimeout(() => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = freq;
      oscillator.type = type;

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration);
    }, i * 100);
  });
}

function playPop(audioContext) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.1);
  oscillator.type = 'sine';

  gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.1);
}
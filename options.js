const notificationsEnabled = document.getElementById('notificationsEnabled');
const persistentNotifications = document.getElementById('persistentNotifications');
const confirmDelete = document.getElementById('confirmDelete');
const refreshInterval = document.getElementById('refreshInterval');
const twitchLoginBtn = document.getElementById('twitchLoginBtn');
const twitchLogoutBtn = document.getElementById('twitchLogoutBtn');
const twitchNotConnected = document.getElementById('twitchNotConnected');
const twitchConnected = document.getElementById('twitchConnected');
const twitchUserAvatar = document.getElementById('twitchUserAvatar');
const twitchUsername = document.getElementById('twitchUsername');
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

const GROUP_COLORS = [
  '#5CFFE0', '#7B5CFF', '#FF4F8B', '#FF3366', '#10B981',
  '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#06B6D4'
];

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadTwitchAuthStatus();
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

  refreshInterval.addEventListener('change', () => {
    saveSettings(false);
    updateAlarm();
  });

  addGroupBtn.addEventListener('click', addGroup);
  newGroupName.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addGroup();
  });

  exportBtn.addEventListener('click', exportData);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importData);

  twitchLoginBtn.addEventListener('click', handleTwitchLogin);
  twitchLogoutBtn.addEventListener('click', handleTwitchLogout);
}

async function loadSettings() {
  try {
    const settings = await DB.getSettings();

    notificationsEnabled.checked = settings.notifications !== false;
    persistentNotifications.checked = settings.persistentNotifications === true;
    confirmDelete.checked = settings.confirmDelete !== false;
    refreshInterval.value = settings.refreshInterval || '5';
  } catch (error) {}
}

async function loadTwitchAuthStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getTwitchAuthStatus' });

    if (response && response.connected && response.user) {
      showTwitchConnected(response.user);
    } else {
      showTwitchDisconnected();
    }
  } catch (error) {
    showTwitchDisconnected();
  }
}

function showTwitchConnected(user) {
  twitchNotConnected.style.display = 'none';
  twitchConnected.style.display = 'flex';
  twitchUsername.textContent = user.display_name || user.login;
  twitchUserAvatar.src = user.profile_image_url || 'icons/logo.png';
}

function showTwitchDisconnected() {
  twitchNotConnected.style.display = 'block';
  twitchConnected.style.display = 'none';
}

async function handleTwitchLogin() {
  twitchLoginBtn.disabled = true;
  twitchLoginBtn.textContent = 'Connexion...';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'twitchLogin' });

    if (response && response.success) {
      showTwitchConnected(response.user);
      showSaveMessage('Connecté à Twitch !');
      chrome.runtime.sendMessage({ action: 'checkNow' });
    } else {
      UI.toast('Erreur de connexion : ' + (response?.error || 'Inconnue'), 'error');
    }
  } catch (error) {
    UI.toast('Erreur de connexion : ' + error.message, 'error');
  } finally {
    twitchLoginBtn.disabled = false;
    twitchLoginBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
      </svg>
      Se connecter avec Twitch
    `;
  }
}

async function handleTwitchLogout() {
  try {
    await chrome.runtime.sendMessage({ action: 'twitchLogout' });
    showTwitchDisconnected();
    showSaveMessage('Déconnecté de Twitch');
  } catch (error) {
    UI.toast('Erreur lors de la déconnexion', 'error');
  }
}

async function saveSettings(showMessage = true) {
  try {
    const settings = {
      notifications: notificationsEnabled.checked,
      persistentNotifications: persistentNotifications.checked,
      confirmDelete: confirmDelete.checked,
      refreshInterval: refreshInterval.value
    };

    await DB.saveSettings(settings);

    chrome.runtime.sendMessage({ action: 'settingsUpdated', settings });

    if (showMessage) {
      saveMessage.classList.add('show');
      setTimeout(() => {
        saveMessage.classList.remove('show');
      }, 2000);
    }

  } catch (error) {
    UI.toast('Erreur lors de la sauvegarde des paramètres', 'error');
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
    const history = await DB.getHistory(50);

    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="empty-history">
          <p>Aucun historique pour le moment</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = '';

    const recentHistory = history.slice(0, 10);

    recentHistory.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';

      const timeAgo = getTimeAgo(item.timestamp);
      const platformClass = `platform-${item.platform}`;

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
  const confirmed = await UI.confirm('Tout l\'historique des lives détectés sera effacé.', {
    title: 'Effacer l\'historique',
    confirmLabel: 'Effacer',
    danger: true
  });
  if (!confirmed) {
    return;
  }

  try {
    await DB.clearHistory();
    await loadHistory();
  } catch (error) {
    UI.toast('Erreur lors de l\'effacement de l\'historique', 'error');
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
    const streamers = await DB.getStreamers();
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

      const teamTitle = document.createElement('h3');
      teamTitle.style.cssText = 'margin: 0; font-size: 16px; color: rgba(92, 255, 224, 0.9);';
      teamTitle.textContent = `${capitalizeTeamName(teamName)} (${members.length})`;

      const teamDeleteBtn = document.createElement('button');
      teamDeleteBtn.className = 'btn-danger-small';
      teamDeleteBtn.dataset.team = teamName;
      teamDeleteBtn.style.cssText = 'padding: 6px 12px; font-size: 12px; background: rgba(255, 82, 82, 0.2); color: #ff5252; border: 1px solid rgba(255, 82, 82, 0.3); border-radius: 6px; cursor: pointer;';
      teamDeleteBtn.textContent = 'Supprimer la team';

      teamHeader.appendChild(teamTitle);
      teamHeader.appendChild(teamDeleteBtn);

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
        const confirmed = await UI.confirm(`Tous les membres de la team ${teamName} seront retirés de votre liste.`, {
          title: 'Supprimer la team',
          confirmLabel: 'Supprimer',
          danger: true
        });
        if (confirmed) {
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
    await DB.deleteTeam(teamName);
    await loadTeamsManagement();
  } catch (error) {}
}

async function deleteMemberFromSettings(streamerId) {
  try {
    await DB.deleteStreamer(streamerId);
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

async function loadGroups() {
  try {
    const groups = await DB.getGroups();
    const streamers = await DB.getStreamers();

    if (groups.length === 0) {
      groupsList.innerHTML = '<div class="empty-groups">Aucun groupe créé</div>';
      return;
    }

    groupsList.innerHTML = '';

    groups.forEach((group) => {
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
    const groups = await DB.getGroups();

    if (groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      UI.toast('Un groupe avec ce nom existe déjà', 'error');
      return;
    }

    const newGroup = {
      id: `group_${Date.now()}`,
      name: name,
      color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
      createdAt: Date.now()
    };

    await DB.addGroup(newGroup);

    newGroupName.value = '';
    await loadGroups();

  } catch (error) {
    UI.toast('Erreur lors de la création du groupe', 'error');
  }
}

async function deleteGroup(groupId) {
  const confirmed = await UI.confirm('Le groupe sera supprimé. Les streamers qu\'il contient ne seront pas supprimés.', {
    title: 'Supprimer le groupe',
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!confirmed) {
    return;
  }

  try {
    await DB.deleteGroup(groupId);
    await loadGroups();
  } catch (error) {
    UI.toast('Erreur lors de la suppression du groupe', 'error');
  }
}

async function exportData() {
  try {
    const streamers = await DB.getStreamers();
    const groups = await DB.getGroups();
    const history = await DB.getHistory(100);
    const settings = await DB.getSettings();

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
    UI.toast('Erreur lors de l\'export', 'error');
  }
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importObj = JSON.parse(text);

    if (!importObj.data) {
      UI.toast('Format de fichier invalide', 'error');
      return;
    }

    const currentStreamers = await DB.getStreamers();
    const currentGroups = await DB.getGroups();

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

    const importedGroups = importObj.data.groups || [];
    const mergedGroups = [...currentGroups];

    importedGroups.forEach(imported => {
      const exists = mergedGroups.some(g => g.name.toLowerCase() === imported.name.toLowerCase());
      if (!exists) {
        mergedGroups.push({ ...imported, id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` });
      }
    });

    await DB.saveStreamers(mergedStreamers);
    await DB.saveGroups(mergedGroups);

    await loadGroups();
    await loadHistory();
    await loadTeamsManagement();

    showSaveMessage(`Import réussi ! ${importedStreamers.length} streamer(s) traités.`);

    importFile.value = '';

    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    UI.toast('Erreur lors de l\'import : ' + error.message, 'error');
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

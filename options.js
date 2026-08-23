const notificationsEnabled = document.getElementById('notificationsEnabled');
const confirmDelete = document.getElementById('confirmDelete');
const twitchLoginBtn = document.getElementById('twitchLoginBtn');
const twitchLogoutBtn = document.getElementById('twitchLogoutBtn');
const twitchNotConnected = document.getElementById('twitchNotConnected');
const twitchConnected = document.getElementById('twitchConnected');
const twitchUserAvatar = document.getElementById('twitchUserAvatar');
const twitchUsername = document.getElementById('twitchUsername');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadTwitchAuthStatus();
  await loadTeamsManagement();
  await loadHistory();
  setupEventListeners();
});

function setupEventListeners() {
  clearHistoryBtn.addEventListener('click', clearHistory);

  [notificationsEnabled, confirmDelete].forEach(toggle => {
    toggle.addEventListener('change', () => {
      saveSettings();
    });
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
    confirmDelete.checked = settings.confirmDelete !== false;
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
      UI.toast('Connecté à Twitch !', 'success');
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
    UI.toast('Déconnecté de Twitch', 'success');
  } catch (error) {
    UI.toast('Erreur lors de la déconnexion', 'error');
  }
}

async function saveSettings() {
  try {
    const settings = {
      notifications: notificationsEnabled.checked,
      confirmDelete: confirmDelete.checked
    };

    await DB.saveSettings(settings);

    chrome.runtime.sendMessage({ action: 'settingsUpdated', settings });
  } catch (error) {
    UI.toast('Erreur lors de la sauvegarde des paramètres', 'error');
  }
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
        <div class="history-time">${timeAgo}</div>
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
      teamsManagement.innerHTML = '<p class="empty-teams">Aucune team ajoutée</p>';
      return;
    }

    teamsManagement.innerHTML = '';

    Object.keys(teamsMap).sort().forEach(teamName => {
      const members = teamsMap[teamName];

      const teamCard = document.createElement('div');
      teamCard.className = 'team-card';

      const teamHeader = document.createElement('div');
      teamHeader.className = 'team-card-header';

      const teamTitle = document.createElement('h3');
      teamTitle.className = 'team-card-title';
      teamTitle.textContent = `${capitalizeTeamName(teamName)} (${members.length})`;

      const teamDeleteBtn = document.createElement('button');
      teamDeleteBtn.className = 'btn-danger-small';
      teamDeleteBtn.dataset.team = teamName;
      teamDeleteBtn.textContent = 'Supprimer la team';

      teamHeader.appendChild(teamTitle);
      teamHeader.appendChild(teamDeleteBtn);

      const membersList = document.createElement('div');
      membersList.className = 'team-members';

      members.forEach(member => {
        const memberItem = document.createElement('div');
        memberItem.className = 'team-member';

        const memberName = document.createElement('span');
        memberName.className = 'team-member-name';
        memberName.textContent = member.name;

        const memberDelete = document.createElement('button');
        memberDelete.className = 'delete-member-btn';
        memberDelete.dataset.id = member.id;
        memberDelete.textContent = '×';

        memberItem.appendChild(memberName);
        memberItem.appendChild(memberDelete);
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

async function exportData() {
  try {
    const streamers = await DB.getStreamers();
    const history = await DB.getHistory(100);
    const settings = await DB.getSettings();

    const exportObj = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      data: {
        streamers,
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

    UI.toast('Export réussi !', 'success');

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

    await DB.saveStreamers(mergedStreamers);

    await loadHistory();
    await loadTeamsManagement();

    UI.toast(`Import réussi ! ${importedStreamers.length} streamer(s) traités.`, 'success');

    importFile.value = '';

    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    UI.toast('Erreur lors de l\'import : ' + error.message, 'error');
    importFile.value = '';
  }
}

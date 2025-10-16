const streamerInput = document.getElementById('streamerInput');
const addBtn = document.getElementById('addBtn');
const settingsBtn = document.getElementById('settingsBtn');
const streamersList = document.getElementById('streamersList');
const emptyState = document.getElementById('emptyState');
const errorMessage = document.getElementById('errorMessage');
const loadingState = document.getElementById('loadingState');

let autocompleteTimeout = null;
let autocompleteList = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadStreamers();
  setupEventListeners();
  createAutocompleteList();
});

function setupEventListeners() {
  addBtn.addEventListener('click', handleAddStreamer);
  streamerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      hideAutocomplete();
      handleAddStreamer();
    }
  });
  
  streamerInput.addEventListener('input', handleAutocomplete);
  streamerInput.addEventListener('focus', handleAutocomplete);
  streamerInput.addEventListener('blur', () => {
    setTimeout(() => hideAutocomplete(), 250);
  });
  
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function createAutocompleteList() {
  autocompleteList = document.createElement('div');
  autocompleteList.className = 'autocomplete-list';
  autocompleteList.style.display = 'none';
  document.querySelector('.add-section').appendChild(autocompleteList);
}

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

    chrome.runtime.sendMessage({ action: 'getStreamersData' }, (response) => {
      showLoading(false);
      
      if (chrome.runtime.lastError) {
        streamers.forEach(streamer => renderStreamerCard(streamer));
        return;
      }
      
      if (response && response.streamers) {
        response.streamers.forEach(streamer => renderStreamerCard(streamer));
      } else {
        streamers.forEach(streamer => renderStreamerCard(streamer));
      }
    });
  } catch (error) {
    showError('Erreur lors du chargement');
    showLoading(false);
  }
}

function handleAutocomplete(e) {
  const query = streamerInput.value.trim();
  
  clearTimeout(autocompleteTimeout);
  
  if (query.length < 2) {
    hideAutocomplete();
    return;
  }

  if (query.toLowerCase().startsWith('team/')) {
    const teamQuery = query.substring(5);
    if (teamQuery.length >= 2) {
      chrome.runtime.sendMessage(
        { action: 'searchTeams', query: teamQuery },
        (response) => {
          if (chrome.runtime.lastError) {
            return;
          }
          
          if (response && response.results && response.results.length > 0) {
            showTeamAutocomplete(response.results);
          } else {
            hideAutocomplete();
          }
        }
      );
    }
    return;
  }

  autocompleteTimeout = setTimeout(() => {
    chrome.runtime.sendMessage(
      { action: 'searchStreamers', query: query },
      (response) => {
        if (chrome.runtime.lastError) {
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

function showTeamAutocomplete(teams) {
  autocompleteList.innerHTML = '';
  autocompleteList.style.display = 'block';

  teams.forEach(team => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item team-item';
    
    item.innerHTML = `
      <div class="team-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div class="autocomplete-info">
        <div class="autocomplete-name">${escapeHtml(team.display_name)}</div>
        <div class="autocomplete-meta">
          <span class="team-badge-small">Team Twitch</span>
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      addTwitchTeamFromAutocomplete(team.name);
    });

    autocompleteList.appendChild(item);
  });
}

function showAutocomplete(results) {
  autocompleteList.innerHTML = '';
  autocompleteList.style.display = 'block';

  results.forEach(result => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    
    const platformIcon = getPlatformIcon(result.platform);
    const platformLabel = result.platform.charAt(0).toUpperCase() + result.platform.slice(1);
    
    const img = document.createElement('img');
    img.src = result.avatar || 'icons/avatars/default.png';
    img.alt = result.name;
    img.className = 'autocomplete-avatar';
    img.addEventListener('error', () => {
      img.src = 'icons/avatars/default.png';
    });
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'autocomplete-info';
    
    let badges = `<span class="platform-badge-small platform-${result.platform}">${platformLabel}</span>`;
    if (result.isLive) {
      badges += '<span class="live-badge">🔴 Live</span>';
    }
    if (result.isPartner) {
      badges += '<span class="partner-badge">✓ Partner</span>';
    }
    
    infoDiv.innerHTML = `
      <div class="autocomplete-name">${escapeHtml(result.name)}</div>
      <div class="autocomplete-meta">
        ${badges}
      </div>
    `;

    item.appendChild(img);
    item.appendChild(infoDiv);

    item.addEventListener('click', () => {
      addStreamerFromAutocomplete(result);
    });

    autocompleteList.appendChild(item);
  });
}

function getPlatformIcon(platform) {
  const icons = {
    twitch: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7"></path></svg>',
    youtube: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>',
    kick: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>'
  };
  return icons[platform] || '';
}

async function addTwitchTeamFromAutocomplete(teamName) {
  hideAutocomplete();
  streamerInput.value = '';
  
  addBtn.disabled = true;
  addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Ajout...';

  chrome.runtime.sendMessage(
    { action: 'addTwitchTeam', teamName: teamName },
    async (response) => {
      if (chrome.runtime.lastError) {
        showError('Erreur lors de l\'ajout de la team');
        addBtn.disabled = false;
        addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Ajouter';
        return;
      }
      
      if (response && response.success) {
        hideError();
        await loadStreamers();
        showError(`Team ${teamName} ajoutée : ${response.count} membres`, false);
      } else {
        showError(response?.error || 'Erreur lors de l\'ajout de la team');
      }

      addBtn.disabled = false;
      addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Ajouter';
    }
  );
}

async function addStreamerFromAutocomplete(result) {
  hideAutocomplete();
  streamerInput.value = '';
  
  try {
    addBtn.disabled = true;
    addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Ajout...';

    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    
    const exists = streamers.some(s => 
      s.platform === result.platform && s.username.toLowerCase() === result.username.toLowerCase()
    );
    
    if (exists) {
      showError('Ce streamer est déjà dans votre liste');
      return;
    }

    const newStreamer = {
      id: `${result.platform}_${result.username}_${Date.now()}`,
      name: result.name,
      username: result.username,
      platform: result.platform,
      avatar: result.avatar || '',
      isLive: result.isLive || false,
      wasLiveRecently: false,
      team: null,
      addedDate: Date.now(),
      priority: 'high'
    };

    streamers.push(newStreamer);
    await chrome.storage.sync.set({ streamers });

    hideError();
    await loadStreamers();

    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    showError('Erreur lors de l\'ajout du streamer');
  } finally {
    addBtn.disabled = false;
    addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Ajouter';
  }
}

async function handleAddStreamer() {
  const input = streamerInput.value.trim();
  
  if (!input) {
    showError('Veuillez entrer une URL ou un nom');
    return;
  }

  try {
    addBtn.disabled = true;
    addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Ajout...';

    if (input.includes('twitch.tv/team/') || input.toLowerCase().startsWith('team/')) {
      const teamMatch = input.match(/(?:twitch\.tv\/team\/|^team\/)([a-zA-Z0-9_-]+)/);
      if (teamMatch) {
        await addTwitchTeamFromAutocomplete(teamMatch[1]);
        return;
      }
    }

    const streamerData = parseStreamerInput(input);
    
    if (!streamerData) {
      showError('URL ou format non reconnu');
      return;
    }

    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    
    const exists = streamers.some(s => 
      s.platform === streamerData.platform && s.username.toLowerCase() === streamerData.username.toLowerCase()
    );
    
    if (exists) {
      showError('Ce streamer est déjà dans votre liste');
      return;
    }

    const newStreamer = {
      id: `${streamerData.platform}_${streamerData.username}_${Date.now()}`,
      name: streamerData.username,
      username: streamerData.username,
      platform: streamerData.platform,
      avatar: '',
      isLive: false,
      wasLiveRecently: false,
      team: null,
      addedDate: Date.now(),
      priority: 'high'
    };

    streamers.push(newStreamer);
    await chrome.storage.sync.set({ streamers });

    streamerInput.value = '';
    hideError();
    await loadStreamers();

    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    showError('Erreur lors de l\'ajout');
  } finally {
    addBtn.disabled = false;
    addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Ajouter';
  }
}

function parseStreamerInput(input) {
  input = input.trim().toLowerCase();

  if (input.includes('twitch.tv/')) {
    const match = input.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
    if (match) return { platform: 'twitch', username: match[1] };
  } else if (input.includes('twitch')) {
    const username = input.replace(/[^a-zA-Z0-9_]/g, '');
    if (username) return { platform: 'twitch', username };
  }

  if (input.includes('youtube.com/') || input.includes('youtu.be/')) {
    const match = input.match(/youtube\.com\/@([a-zA-Z0-9_-]+)|youtube\.com\/channel\/([a-zA-Z0-9_-]+)|youtube\.com\/c\/([a-zA-Z0-9_-]+)/);
    if (match) {
      const username = match[1] || match[2] || match[3];
      return { platform: 'youtube', username };
    }
  }

  if (input.includes('kick.com/')) {
    const match = input.match(/kick\.com\/([a-zA-Z0-9_-]+)/);
    if (match) return { platform: 'kick', username: match[1] };
  }

  if (/^[a-zA-Z0-9_]+$/.test(input)) {
    return { platform: 'twitch', username: input };
  }

  return null;
}

function hideAutocomplete() {
  if (autocompleteList) {
    autocompleteList.style.display = 'none';
  }
}

function renderStreamerCard(streamer) {
  const card = document.createElement('div');
  const isRecent = streamer.wasLiveRecently && !streamer.isLive;
  card.className = `streamer-card ${streamer.isLive ? 'live' : ''} ${isRecent ? 'ended' : ''}`;
  card.style.opacity = '0';
  card.style.transform = 'translateX(-20px)';
  
  const statusText = getStatusText(streamer);
  const statusClass = streamer.isLive ? 'live' : (streamer.wasLiveRecently ? 'recent' : 'offline');
  const statusEmoji = streamer.isLive ? '🔴' : (streamer.wasLiveRecently ? '⚫' : '⚫');
  const platformIcon = getPlatformIcon(streamer.platform);
  const avatarUrl = streamer.avatar && streamer.avatar !== '' ? streamer.avatar : 'icons/avatars/default.png';
  
  const teamName = streamer.team ? capitalizeTeamName(streamer.team) : '—';
  const teamLogoUrl = streamer.teamLogo || (streamer.team ? `icons/teams/${streamer.team.toLowerCase()}.svg` : 'icons/teams/default.svg');
  
  const img = document.createElement('img');
  img.src = avatarUrl;
  img.alt = streamer.name;
  img.className = 'streamer-avatar';
  img.onerror = null;
  img.addEventListener('error', () => {
    img.src = 'icons/avatars/default.png';
  });
  
  const infoDiv = document.createElement('div');
  infoDiv.className = 'streamer-info';
  
  const mainLineHTML = `
    <div class="streamer-main-line">
      <span class="platform-icon platform-${streamer.platform}" title="${streamer.platform}">
        ${platformIcon}
      </span>
      <div class="streamer-name" title="${escapeHtml(streamer.name)}">${escapeHtml(streamer.name)}</div>
      <span class="status-indicator ${statusClass}">
        <span class="status-dot ${statusClass}"></span>
        <span class="status-emoji">${statusEmoji}</span>
        ${statusText}
      </span>
    </div>
  `;
  
  let secondaryLineHTML = '<div class="streamer-secondary-line">';
  
  if (streamer.title) {
    const titleClass = isRecent ? 'streamer-title ended' : 'streamer-title';
    secondaryLineHTML += `<div class="${titleClass}" title="${escapeHtml(streamer.title)}">${escapeHtml(streamer.title)}</div>`;
  }
  
  secondaryLineHTML += `
    <div class="team-info">
      ${streamer.team ? `<img src="${teamLogoUrl}" alt="${teamName}" class="team-logo" onerror="this.src='icons/teams/default.svg'">` : ''}
      <span class="team-name ${!streamer.team ? 'no-team' : ''}">${teamName}</span>
    </div>
  `;
  
  secondaryLineHTML += '</div>';
  
  infoDiv.innerHTML = mainLineHTML + secondaryLineHTML;
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.title = 'Supprimer';
  deleteBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  
  card.appendChild(img);
  card.appendChild(infoDiv);
  card.appendChild(deleteBtn);

  setTimeout(() => {
    card.style.transition = 'all 0.3s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateX(0)';
  }, 50);

  card.addEventListener('click', (e) => {
    if (!e.target.closest('.delete-btn')) {
      openStream(streamer);
    }
  });

  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    
    const { settings = {} } = await chrome.storage.sync.get('settings');
    const shouldConfirm = settings.confirmDelete !== false;
    
    if (streamer.team) {
      if (!shouldConfirm || confirm(`Supprimer tous les membres de la team ${streamer.team} ?`)) {
        await deleteTeam(streamer.team);
      }
    } else {
      if (!shouldConfirm || confirm(`Supprimer ${streamer.name} ?`)) {
        await deleteStreamer(streamer.id, card);
      }
    }
  });

  streamersList.appendChild(card);
}

function capitalizeTeamName(teamName) {
  return teamName.charAt(0).toUpperCase() + teamName.slice(1).toLowerCase();
}

function getStatusText(streamer) {
  if (streamer.isLive) {
    return streamer.viewerCount ? `En live - ${formatViewers(streamer.viewerCount)}` : 'En live';
  }
  if (streamer.lastLiveDate && !streamer.isLive) {
    const hoursSince = Math.floor((Date.now() - streamer.lastLiveDate) / (1000 * 60 * 60));
    if (hoursSince < 24) {
      return hoursSince === 0 ? 'Terminé il y a moins d\'1h' : `Terminé il y a ${hoursSince}h`;
    }
  }
  if (streamer.wasLiveRecently && streamer.lastLiveDate) {
    const hoursSince = Math.floor((Date.now() - streamer.lastLiveDate) / (1000 * 60 * 60));
    return hoursSince === 0 ? 'Terminé il y a moins d\'1h' : `Terminé il y a ${hoursSince}h`;
  }
  return 'Hors ligne';
}

function formatViewers(count) {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}

async function deleteStreamer(id, cardElement) {
  try {
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
    showError('Erreur lors de la suppression');
  }
}

async function deleteTeam(teamName) {
  try {
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    const filtered = streamers.filter(s => s.team !== teamName);
    await chrome.storage.sync.set({ streamers: filtered });
    await loadStreamers();
  } catch (error) {
    showError('Erreur lors de la suppression de la team');
  }
}

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

function showEmptyState(show) {
  emptyState.classList.toggle('hidden', !show);
  streamersList.style.display = show ? 'none' : 'flex';
}

function showLoading(show) {
  loadingState.style.display = show ? 'block' : 'none';
  streamersList.style.display = show ? 'none' : 'flex';
}

function showError(message, isError = true) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  errorMessage.style.background = isError ? 'rgba(255, 82, 82, 0.1)' : 'rgba(92, 255, 224, 0.1)';
  errorMessage.style.borderColor = isError ? 'rgba(255, 82, 82, 0.3)' : 'rgba(92, 255, 224, 0.3)';
  errorMessage.style.color = isError ? '#FF5252' : '#5CFFE0';
  setTimeout(() => hideError(), 5000);
}

function hideError() {
  errorMessage.classList.remove('show');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadStreamers();
  }
}, 15000);
const streamerInput = document.getElementById('streamerInput');
const addBtn = document.getElementById('addBtn');
const settingsBtn = document.getElementById('settingsBtn');
const streamersList = document.getElementById('streamersList');
const emptyState = document.getElementById('emptyState');
const errorMessage = document.getElementById('errorMessage');
const loadingState = document.getElementById('loadingState');
const filtersBar = document.getElementById('filtersBar');
const compactBtn = document.getElementById('compactBtn');
const refreshBtn = document.getElementById('refreshBtn');

let autocompleteTimeout = null;
let autocompleteList = null;
let currentStreamersMap = new Map();
let isInitialLoad = true;
let currentFilter = 'all';
let currentGroupFilter = '';
let allStreamersData = [];
let isCompactMode = false;
const groupFilterWrapper = document.getElementById('groupFilterWrapper');
const groupFilterBtn = document.getElementById('groupFilterBtn');
const groupFilterDropdown = document.getElementById('groupFilterDropdown');
const authErrorBanner = document.getElementById('authErrorBanner');
const authErrorBtn = document.getElementById('authErrorBtn');
const twitchConnectBanner = document.getElementById('twitchConnectBanner');
const twitchConnectBtn = document.getElementById('twitchConnectBtn');

const ICON_ADD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
const ICON_SPINNER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
const ICON_GAME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13h4m-2-2v4m3 1h.01M17 16h.01M2 12V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z"/></svg>';
const ICON_VIEWERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_CHEVRON = '<svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const ICON_BELL_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
const ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

function setAddBtnLoading() {
  addBtn.disabled = true;
  addBtn.innerHTML = `${ICON_SPINNER} Ajout...`;
}

function setAddBtnDefault() {
  addBtn.disabled = false;
  addBtn.innerHTML = `${ICON_ADD} Ajouter`;
}

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthError();
  await checkTwitchConnection();
  await loadGroups();
  await loadStreamers();
  setupEventListeners();
  createAutocompleteList();
  refreshStreamers();
});

async function checkAuthError() {
  try {
    const hasAuthError = await DB.getAuthError();
    authErrorBanner.classList.toggle('hidden', !hasAuthError);
  } catch {
    authErrorBanner.classList.add('hidden');
  }
}

async function checkTwitchConnection() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getTwitchAuthStatus' });
    twitchConnectBanner.classList.toggle('hidden', !!(response && response.connected));
  } catch {
    twitchConnectBanner.classList.add('hidden');
  }
}

async function handleTwitchConnect() {
  twitchConnectBtn.disabled = true;
  twitchConnectBtn.textContent = 'Connexion...';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'twitchLogin' });

    if (response && response.success) {
      twitchConnectBanner.classList.add('hidden');
      UI.toast('Connecté à Twitch !', 'success');
      await loadGroups();
      refreshStreamers();
    } else {
      UI.toast('Erreur de connexion : ' + (response?.error || 'Inconnue'), 'error');
    }
  } catch (error) {
    UI.toast('Erreur de connexion : ' + error.message, 'error');
  } finally {
    twitchConnectBtn.disabled = false;
    twitchConnectBtn.textContent = 'Se connecter';
  }
}

async function loadGroups() {
  const streamers = await DB.getStreamers();

  const teamsSet = new Set();
  streamers.forEach(s => {
    if (s.team) teamsSet.add(s.team);
  });
  const teams = Array.from(teamsSet).sort();

  let dropdownHTML = '';
  dropdownHTML += '<div class="filter-group-dropdown-item clear-filter" data-value="">Toutes les teams</div>';

  teams.forEach(teamName => {
    dropdownHTML += `<div class="filter-group-dropdown-item" data-value="team:${teamName}">${escapeHtml(capitalizeTeamName(teamName))}</div>`;
  });

  groupFilterDropdown.innerHTML = dropdownHTML;

  groupFilterWrapper.style.display = teams.length === 0 ? 'none' : 'block';
}

function sortStreamers(streamersData) {
  return [...streamersData].sort((a, b) => {
    if (a.isLive !== b.isLive) return b.isLive - a.isLive;
    const aTime = a.isLive ? (a.startedAt || a.lastLiveDate || 0) : (a.lastLiveDate || 0);
    const bTime = b.isLive ? (b.startedAt || b.lastLiveDate || 0) : (b.lastLiveDate || 0);
    return bTime - aTime;
  });
}

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

  authErrorBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  twitchConnectBtn.addEventListener('click', handleTwitchConnect);

  refreshBtn.addEventListener('click', () => {
    if (!refreshBtn.classList.contains('loading')) {
      refreshStreamers();
    }
  });

  filtersBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    const filter = btn.dataset.filter;
    if (filter === currentFilter) return;

    filtersBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = filter;

    applyFilter();
  });

  compactBtn.addEventListener('click', async () => {
    isCompactMode = !isCompactMode;
    compactBtn.classList.toggle('active', isCompactMode);
    streamersList.classList.toggle('compact', isCompactMode);

    const settings = await DB.getSettings();
    settings.compactMode = isCompactMode;
    await DB.saveSettings(settings);
  });

  DB.getSettings().then((settings) => {
    if (settings.compactMode) {
      isCompactMode = true;
      compactBtn.classList.add('active');
      streamersList.classList.add('compact');
    }
  });

  groupFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    groupFilterWrapper.classList.toggle('open');
  });

  groupFilterDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.filter-group-dropdown-item');
    if (!item) return;

    const value = item.dataset.value;
    currentGroupFilter = value;

    groupFilterDropdown.querySelectorAll('.filter-group-dropdown-item').forEach(i => {
      i.classList.toggle('selected', i.dataset.value === value);
    });

    groupFilterBtn.classList.toggle('active', value !== '');

    groupFilterWrapper.classList.remove('open');

    applyFilter();
  });

  document.addEventListener('click', (e) => {
    if (!groupFilterWrapper.contains(e.target)) {
      groupFilterWrapper.classList.remove('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.snooze-btn') && !e.target.closest('.snooze-menu')) {
      closeSnoozeMenus();
    }
  });
}

function createAutocompleteList() {
  autocompleteList = document.createElement('div');
  autocompleteList.className = 'autocomplete-list';
  autocompleteList.style.display = 'none';
  document.querySelector('.add-section').appendChild(autocompleteList);
}

function applyFilter() {
  const filteredStreamers = filterStreamers(allStreamersData, currentFilter);

  if (filteredStreamers.length === 0 && allStreamersData.length > 0) {
    showEmptyState(false);
    streamersList.innerHTML = '<div class="no-filter-results">Aucun streamer ne correspond à ce filtre</div>';
    return;
  }

  if (filteredStreamers.length === 0) {
    showEmptyState(true);
    return;
  }

  showEmptyState(false);
  updateStreamersWithDiff(filteredStreamers);
}

function filterStreamers(streamers, filter) {
  let filtered = streamers;

  if (filter === 'online') {
    filtered = filtered.filter(s => s.isLive);
  } else if (filter === 'offline') {
    filtered = filtered.filter(s => !s.isLive);
  }

  if (currentGroupFilter.startsWith('team:')) {
    const teamName = currentGroupFilter.replace('team:', '');
    filtered = filtered.filter(s => s.team === teamName);
  }

  return filtered;
}

async function loadStreamers() {
  try {
    const scrollTop = document.body.scrollTop || document.documentElement.scrollTop;

    const streamers = await DB.getStreamers();

    if (streamers.length === 0) {
      showEmptyState(true);
      showLoading(false);
      currentStreamersMap.clear();
      streamersList.innerHTML = '';
      allStreamersData = [];
      isInitialLoad = true;
      return;
    }

    showEmptyState(false);

    if (isInitialLoad) {
      showSkeletons(streamers.length);
    }

    const streamersData = await DB.getStreamersData();
    const resolved = streamersData.length > 0 ? streamersData : streamers;

    const sortedStreamers = sortStreamers(resolved);

    allStreamersData = sortedStreamers;

    const filteredStreamers = filterStreamers(sortedStreamers, currentFilter);

    if (filteredStreamers.length === 0 && sortedStreamers.length > 0) {
      streamersList.innerHTML = '<div class="no-filter-results">Aucun streamer ne correspond à ce filtre</div>';
    } else {
      updateStreamersWithDiff(filteredStreamers);
    }

    showLoading(false);
    isInitialLoad = false;

    requestAnimationFrame(() => {
      document.body.scrollTop = scrollTop;
      document.documentElement.scrollTop = scrollTop;
    });
  } catch (error) {
    showError('Erreur lors du chargement');
    showLoading(false);
  }
}

function refreshStreamers() {
  refreshBtn.classList.add('loading');
  chrome.runtime.sendMessage({ action: 'checkNow' }, async () => {
    if (!chrome.runtime.lastError) {
      await loadStreamers();
      await checkAuthError();
    }
    refreshBtn.classList.remove('loading');
  });
}

function showSkeletons(count) {
  streamersList.innerHTML = '';
  for (let i = 0; i < Math.min(count, 5); i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'streamer-card skeleton';
    skeleton.innerHTML = `
      <div class="skeleton-avatar"></div>
      <div class="skeleton-info">
        <div class="skeleton-line skeleton-name"></div>
        <div class="skeleton-line skeleton-title"></div>
      </div>
    `;
    streamersList.appendChild(skeleton);
  }
}

function updateStreamersWithDiff(newStreamers) {
  const newStreamersMap = new Map(newStreamers.map(s => [s.id, s]));
  const existingIds = new Set(currentStreamersMap.keys());
  const newIds = new Set(newStreamersMap.keys());

  for (const id of existingIds) {
    if (!newIds.has(id)) {
      const card = streamersList.querySelector(`[data-streamer-id="${id}"]`);
      if (card) {
        card.classList.add('removing');
        setTimeout(() => card.remove(), 300);
      }
      currentStreamersMap.delete(id);
    }
  }

  const skeletons = streamersList.querySelectorAll('.skeleton');
  skeletons.forEach(s => s.remove());

  newStreamers.forEach((streamer, index) => {
    const existingData = currentStreamersMap.get(streamer.id);
    const existingCard = streamersList.querySelector(`[data-streamer-id="${streamer.id}"]`);

    if (existingCard && existingData) {
      if (hasStreamerChanged(existingData, streamer)) {
        updateStreamerCard(existingCard, existingData, streamer);
      }
      const currentIndex = Array.from(streamersList.children).indexOf(existingCard);
      if (currentIndex !== index) {
        const referenceNode = streamersList.children[index];
        if (referenceNode !== existingCard) {
          streamersList.insertBefore(existingCard, referenceNode);
        }
      }
    } else {
      const card = createStreamerCard(streamer);
      if (index < streamersList.children.length) {
        streamersList.insertBefore(card, streamersList.children[index]);
      } else {
        streamersList.appendChild(card);
      }
    }

    currentStreamersMap.set(streamer.id, { ...streamer });
  });
}

function hasStreamerChanged(oldData, newData) {
  return oldData.isLive !== newData.isLive ||
         oldData.wasLiveRecently !== newData.wasLiveRecently ||
         oldData.title !== newData.title ||
         oldData.viewerCount !== newData.viewerCount ||
         oldData.avatar !== newData.avatar ||
         oldData.team !== newData.team ||
         oldData.thumbnail !== newData.thumbnail ||
         oldData.game !== newData.game ||
         oldData.snoozedUntil !== newData.snoozedUntil ||
         oldData.nextStreamAt !== newData.nextStreamAt;
}

function updateStreamerCard(card, oldData, newData) {
  if (oldData.isLive !== newData.isLive) {
    if (newData.isLive) {
      card.classList.add('going-live', 'live-pulse');
      setTimeout(() => {
        card.classList.remove('going-live');
        card.classList.add('live');
        card.classList.remove('ended');
      }, 50);
      setTimeout(() => {
        card.classList.remove('live-pulse');
      }, 1000);
    } else {
      card.classList.add('going-offline');
      setTimeout(() => {
        card.classList.remove('going-offline', 'live');
        if (newData.wasLiveRecently) {
          card.classList.add('ended');
        }
      }, 300);
    }
  }

  if (!newData.isLive && newData.wasLiveRecently && !card.classList.contains('ended')) {
    card.classList.add('ended');
  } else if (!newData.wasLiveRecently && card.classList.contains('ended')) {
    card.classList.remove('ended');
  }

  if (oldData.snoozedUntil !== newData.snoozedUntil) {
    updateSnoozeButton(card, newData.snoozedUntil);
  }

  if (oldData.nextStreamAt !== newData.nextStreamAt) {
    const existingSchedule = card.querySelector('.schedule-info');
    const scheduleText = getScheduleText(newData);

    if (scheduleText) {
      const html = `${ICON_CALENDAR}<span>Prochain stream ${scheduleText}</span>`;
      if (existingSchedule) {
        existingSchedule.innerHTML = html;
      } else {
        const scheduleDiv = document.createElement('div');
        scheduleDiv.className = 'schedule-info';
        scheduleDiv.innerHTML = html;
        card.querySelector('.streamer-info').appendChild(scheduleDiv);
      }
    } else if (existingSchedule) {
      existingSchedule.remove();
    }
  }

  const statusIndicator = card.querySelector('.status-indicator');
  if (statusIndicator) {
    const statusText = getStatusText(newData);
    const statusClass = newData.isLive ? 'live' : (newData.wasLiveRecently ? 'recent' : 'offline');

    statusIndicator.className = `status-indicator ${statusClass}`;
    statusIndicator.innerHTML = `<span class="status-dot ${statusClass}"></span>${statusText}`;
  }

  if (oldData.title !== newData.title) {
    const titleEl = card.querySelector('.streamer-title');
    if (titleEl && newData.title) {
      titleEl.textContent = newData.title;
      titleEl.title = newData.title;
    }
  }

  if (oldData.avatar !== newData.avatar && newData.avatar) {
    const avatarEl = card.querySelector('.streamer-avatar');
    if (avatarEl) {
      avatarEl.src = newData.avatar;
    }
  }

  const existingPreview = card.querySelector('.stream-preview');
  if (newData.isLive && newData.thumbnail) {
    if (existingPreview) {
      const thumbnailEl = existingPreview.querySelector('.stream-preview-thumbnail');
      if (thumbnailEl) thumbnailEl.src = newData.thumbnail;

      const gameEl = existingPreview.querySelector('.stream-preview-game');
      if (gameEl) {
        gameEl.innerHTML = `${ICON_GAME} ${escapeHtml(newData.game || 'Stream en cours')}`;
      }

      const viewersEl = existingPreview.querySelector('.stream-preview-viewers');
      if (newData.viewerCount) {
        if (viewersEl) {
          viewersEl.innerHTML = `${ICON_VIEWERS} ${formatViewers(newData.viewerCount)} spectateurs`;
        } else {
          const infoEl = existingPreview.querySelector('.stream-preview-info');
          if (infoEl) {
            const viewersDiv = document.createElement('div');
            viewersDiv.className = 'stream-preview-viewers';
            viewersDiv.innerHTML = `${ICON_VIEWERS} ${formatViewers(newData.viewerCount)} spectateurs`;
            infoEl.appendChild(viewersDiv);
          }
        }
      }
    } else {
      const preview = createStreamPreview(newData);
      card.appendChild(preview);

      const mainLine = card.querySelector('.streamer-main-line');
      if (mainLine && !mainLine.querySelector('.preview-toggle')) {
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'preview-toggle';
        toggleBtn.title = 'Aperçu du stream';
        toggleBtn.innerHTML = ICON_CHEVRON;
        mainLine.appendChild(toggleBtn);
      }
    }
  } else if (existingPreview) {
    existingPreview.remove();
    card.classList.remove('preview-open');
    const toggleBtn = card.querySelector('.preview-toggle');
    if (toggleBtn) toggleBtn.remove();
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

    const img = document.createElement('img');
    img.src = result.avatar || 'icons/avatars/default.svg';
    img.alt = result.name;
    img.className = 'autocomplete-avatar';
    img.addEventListener('error', () => {
      img.src = 'icons/avatars/default.svg';
    });

    const infoDiv = document.createElement('div');
    infoDiv.className = 'autocomplete-info';

    let badges = '';
    if (result.isLive) {
      badges += '<span class="live-badge"><svg width="8" height="8" viewBox="0 0 24 24" fill="#ef4444" stroke="none"><circle cx="12" cy="12" r="10"/></svg> Live</span>';
    }
    if (result.isPartner) {
      badges += '<span class="partner-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Partner</span>';
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

  setAddBtnLoading();

  chrome.runtime.sendMessage(
    { action: 'addTwitchTeam', teamName: teamName },
    async (response) => {
      if (chrome.runtime.lastError) {
        showError('Erreur lors de l\'ajout de la team');
        setAddBtnDefault();
        return;
      }

      if (response && response.success) {
        hideError();
        await loadStreamers();
        showError(`Team ${teamName} ajoutée : ${response.count} membres`, false);
      } else {
        showError(response?.error || 'Erreur lors de l\'ajout de la team');
      }

      setAddBtnDefault();
    }
  );
}

async function addStreamerFromAutocomplete(result) {
  hideAutocomplete();
  streamerInput.value = '';

  try {
    setAddBtnLoading();

    const streamers = await DB.getStreamers();

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

    await DB.addStreamer(newStreamer);

    hideError();
    await loadStreamers();

    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    showError('Erreur lors de l\'ajout du streamer');
  } finally {
    setAddBtnDefault();
  }
}

async function handleAddStreamer() {
  const input = streamerInput.value.trim();

  if (!input) {
    showError('Veuillez entrer une URL ou un nom');
    return;
  }

  try {
    setAddBtnLoading();

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

    const streamers = await DB.getStreamers();

    const exists = streamers.some(s =>
      s.platform === streamerData.platform && s.username.toLowerCase() === streamerData.username.toLowerCase()
    );

    if (exists) {
      showError('Ce streamer est déjà dans votre liste');
      return;
    }

    let streamerInfo = null;
    if (streamerData.platform === 'twitch') {
      const exactResponse = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { action: 'getExactStreamer', username: streamerData.username },
          (response) => resolve(chrome.runtime.lastError ? null : response)
        );
      });
      streamerInfo = exactResponse?.streamer || null;
    }

    if (!streamerInfo) {
      showError('Streamer introuvable sur Twitch, vérifie le pseudo ou le lien');
      return;
    }

    const newStreamer = {
      id: `${streamerData.platform}_${streamerInfo.username}_${Date.now()}`,
      name: streamerInfo.name,
      username: streamerInfo.username,
      platform: streamerData.platform,
      avatar: streamerInfo.avatar || '',
      isLive: streamerInfo.isLive || false,
      wasLiveRecently: false,
      team: null,
      addedDate: Date.now(),
      priority: 'high'
    };

    await DB.addStreamer(newStreamer);

    streamerInput.value = '';
    hideError();
    await loadStreamers();

    chrome.runtime.sendMessage({ action: 'checkNow' });

  } catch (error) {
    showError('Erreur lors de l\'ajout');
  } finally {
    setAddBtnDefault();
  }
}

function parseStreamerInput(input) {
  input = input.trim().toLowerCase();

  if (input.includes('twitch.tv/')) {
    const match = input.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
    if (match) return { platform: 'twitch', username: match[1] };
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

function createStreamerCard(streamer) {
  const card = document.createElement('div');
  const isRecent = streamer.wasLiveRecently && !streamer.isLive;
  const isSnoozedNow = streamer.snoozedUntil && streamer.snoozedUntil > Date.now();
  card.className = `streamer-card ${streamer.isLive ? 'live' : ''} ${isRecent ? 'ended' : ''} ${isSnoozedNow ? 'snoozed' : ''}`;
  card.dataset.streamerId = streamer.id;
  card.style.opacity = '0';
  card.style.transform = 'translateX(-20px)';

  const statusText = getStatusText(streamer);
  const statusClass = streamer.isLive ? 'live' : (streamer.wasLiveRecently ? 'recent' : 'offline');
  const isToggleable = streamer.isLive && !!streamer.thumbnail;
  const platformIcon = getPlatformIcon(streamer.platform);
  const avatarUrl = streamer.avatar && streamer.avatar !== '' ? streamer.avatar : 'icons/avatars/default.svg';

  const teamName = streamer.team ? capitalizeTeamName(streamer.team) : '—';
  const teamLogoUrl = streamer.teamLogo || 'icons/teams/default.svg';

  const img = document.createElement('img');
  img.src = avatarUrl;
  img.alt = streamer.name;
  img.className = 'streamer-avatar';
  img.onerror = null;
  img.addEventListener('error', () => {
    img.src = 'icons/avatars/default.svg';
  });

  const infoDiv = document.createElement('div');
  infoDiv.className = 'streamer-info';

  const mainLineHTML = `
    <div class="streamer-main-line">
      <div class="streamer-name" title="${escapeHtml(streamer.name)}">${escapeHtml(streamer.name)}</div>
      <span class="status-indicator ${statusClass}">
        <span class="status-dot ${statusClass}"></span>
        ${statusText}
      </span>
      ${isToggleable ? `<button type="button" class="preview-toggle" title="Aperçu du stream">${ICON_CHEVRON}</button>` : ''}
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
      <span class="team-name ${!streamer.team ? 'no-team' : ''}" title="${escapeHtml(teamName)}">${teamName}</span>
    </div>
  `;

  secondaryLineHTML += '</div>';

  const scheduleText = getScheduleText(streamer);
  const scheduleLineHTML = scheduleText
    ? `<div class="schedule-info">${ICON_CALENDAR}<span>Prochain stream ${scheduleText}</span></div>`
    : '';

  infoDiv.innerHTML = mainLineHTML + secondaryLineHTML + scheduleLineHTML;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.title = 'Supprimer';
  deleteBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  const snoozeBtn = document.createElement('button');
  snoozeBtn.className = `snooze-btn${isSnoozedNow ? ' active' : ''}`;
  snoozeBtn.title = isSnoozedNow ? 'Notifications en pause' : 'Mettre les notifications en pause';
  snoozeBtn.innerHTML = ICON_BELL_OFF;

  const gridPlatform = document.createElement('span');
  gridPlatform.className = `grid-platform platform-${streamer.platform}`;
  gridPlatform.innerHTML = platformIcon;

  const mainRow = document.createElement('div');
  mainRow.className = 'card-main-row';
  mainRow.appendChild(img);
  mainRow.appendChild(infoDiv);

  card.appendChild(mainRow);
  card.appendChild(snoozeBtn);
  card.appendChild(deleteBtn);
  card.appendChild(gridPlatform);

  if (isToggleable) {
    const preview = createStreamPreview(streamer);
    card.appendChild(preview);
  }

  setTimeout(() => {
    card.style.transition = 'all 0.3s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateX(0)';
  }, 50);

  setTimeout(() => {
    card.style.transition = '';
    card.style.opacity = '';
    card.style.transform = '';
  }, 400);

  card.addEventListener('click', (e) => {
    if (e.target.closest('.delete-btn') || e.target.closest('.snooze-btn') || e.target.closest('.snooze-menu')) return;

    if (e.target.closest('.preview-toggle')) {
      e.stopPropagation();
      toggleStreamPreview(card);
      return;
    }

    if (!e.target.closest('.stream-preview')) {
      openStream(streamer);
    }
  });

  snoozeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (card.querySelector('.snooze-menu')) {
      closeSnoozeMenus();
      return;
    }
    openSnoozeMenu(card, streamer);
  });

  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    const settings = await DB.getSettings();
    const shouldConfirm = settings.confirmDelete !== false;

    if (streamer.team) {
      if (!shouldConfirm) {
        await deleteStreamer(streamer.id, card);
      } else {
        showDeleteTeamModal(streamer, card);
      }
    } else if (!shouldConfirm || await UI.confirm(`${streamer.name} sera retiré de votre liste.`, {
      title: 'Supprimer le streamer',
      confirmLabel: 'Supprimer',
      danger: true
    })) {
      await deleteStreamer(streamer.id, card);
    }
  });

  return card;
}

function closeSnoozeMenus() {
  document.querySelectorAll('.snooze-menu').forEach(menu => menu.remove());
}

function getTomorrowMorning() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

function openSnoozeMenu(card, streamer) {
  closeSnoozeMenus();

  const isSnoozed = streamer.snoozedUntil && streamer.snoozedUntil > Date.now();

  const menu = document.createElement('div');
  menu.className = 'snooze-menu';

  menu.innerHTML = isSnoozed
    ? '<div class="snooze-menu-item" data-action="cancel">Annuler la pause</div>'
    : `
      <div class="snooze-menu-item" data-action="1h">Pause 1 heure</div>
      <div class="snooze-menu-item" data-action="tomorrow">Pause jusqu'à demain</div>
    `;

  menu.addEventListener('click', async (e) => {
    e.stopPropagation();
    const action = e.target.dataset.action;
    if (!action) return;

    let until = null;
    if (action === '1h') until = Date.now() + 60 * 60 * 1000;
    else if (action === 'tomorrow') until = getTomorrowMorning();

    closeSnoozeMenus();
    await applySnooze(streamer, until, card);
  });

  card.appendChild(menu);
}

async function applySnooze(streamer, until, card) {
  await DB.setSnooze(streamer.id, until);
  streamer.snoozedUntil = until;

  const cached = currentStreamersMap.get(streamer.id);
  if (cached) cached.snoozedUntil = until;

  updateSnoozeButton(card, until);
  UI.toast(until ? 'Notifications en pause pour ce streamer' : 'Notifications réactivées', 'success');
}

function updateSnoozeButton(card, until) {
  const btn = card.querySelector('.snooze-btn');
  if (!btn) return;

  const isSnoozed = until && until > Date.now();
  btn.classList.toggle('active', isSnoozed);
  btn.title = isSnoozed ? 'Notifications en pause' : 'Mettre les notifications en pause';
  card.classList.toggle('snoozed', isSnoozed);
}

function capitalizeTeamName(teamName) {
  return teamName.charAt(0).toUpperCase() + teamName.slice(1).toLowerCase();
}

function toggleStreamPreview(card) {
  const preview = card.querySelector('.stream-preview');
  if (!preview) return;

  const isOpen = preview.classList.toggle('open');
  card.classList.toggle('preview-open', isOpen);
}

function createStreamPreview(streamer) {
  const preview = document.createElement('div');
  preview.className = 'stream-preview';

  const gameText = streamer.game ? escapeHtml(streamer.game) : 'Stream en cours';
  const viewersText = streamer.viewerCount ? formatViewers(streamer.viewerCount) + ' spectateurs' : '';

  preview.innerHTML = `
    <img src="${streamer.thumbnail}" alt="Stream preview" class="stream-preview-thumbnail" onerror="this.style.display='none'">
    <div class="stream-preview-info">
      <div class="stream-preview-game">${ICON_GAME} ${gameText}</div>
      ${viewersText ? `<div class="stream-preview-viewers">${ICON_VIEWERS} ${viewersText}</div>` : ''}
    </div>
  `;

  return preview;
}

function getStatusText(streamer) {
  if (streamer.isLive) {
    return streamer.viewerCount ? formatViewers(streamer.viewerCount) : 'Live';
  }
  if (streamer.lastLiveDate) {
    return formatTimeSince(streamer.lastLiveDate);
  }
  return 'Hors ligne';
}

function formatTimeSince(timestamp) {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return '< 1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(diff / 86400000);
  if (days < 7) return `${days}j`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}sem`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mois`;
  const years = Math.floor(days / 365);
  return `${years}an${years > 1 ? 's' : ''}`;
}

function formatTimeUntil(timestamp) {
  const diff = timestamp - Date.now();
  if (diff <= 0) return null;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `dans ${minutes}min`;

  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `dans ${hours}h`;

  const days = Math.floor(diff / 86400000);
  if (days === 1) return 'demain';
  if (days < 7) return `dans ${days}j`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getScheduleText(streamer) {
  if (streamer.isLive || !streamer.nextStreamAt) return null;
  return formatTimeUntil(streamer.nextStreamAt);
}

function formatViewers(count) {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}

async function deleteStreamer(id, cardElement) {
  try {
    await DB.deleteStreamer(id);

    currentStreamersMap.delete(id);

    cardElement.classList.add('removing');
    cardElement.style.transition = 'all 0.3s ease';
    cardElement.style.opacity = '0';
    cardElement.style.transform = 'translateX(20px)';

    setTimeout(() => {
      cardElement.remove();
      if (currentStreamersMap.size === 0) {
        showEmptyState(true);
        isInitialLoad = true;
      }
    }, 300);
  } catch (error) {
    showError('Erreur lors de la suppression');
  }
}

async function deleteTeam(teamName) {
  try {
    await DB.deleteTeam(teamName);
    await loadStreamers();
  } catch (error) {
    showError('Erreur lors de la suppression de la team');
  }
}

function showDeleteTeamModal(streamer, cardElement) {
  const existingModal = document.querySelector('.delete-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.className = 'delete-modal';
  modal.innerHTML = `
    <div class="delete-modal-content">
      <div class="delete-modal-header">
        <span class="delete-modal-title">Supprimer</span>
        <button class="delete-modal-close">&times;</button>
      </div>
      <p class="delete-modal-text">${escapeHtml(streamer.name)} fait partie de la team <strong>${escapeHtml(capitalizeTeamName(streamer.team))}</strong></p>
      <div class="delete-modal-buttons">
        <button class="delete-btn-streamer">Ce streamer</button>
        <button class="delete-btn-team">Toute la team</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('.delete-modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  modal.querySelector('.delete-btn-streamer').addEventListener('click', async () => {
    modal.remove();
    await deleteStreamer(streamer.id, cardElement);
  });

  modal.querySelector('.delete-btn-team').addEventListener('click', async () => {
    modal.remove();
    await deleteTeam(streamer.team);
  });
}

function openStream(streamer) {
  if (streamer.platform === 'twitch') {
    chrome.tabs.create({ url: `https://twitch.tv/${streamer.username}` });
  }
}

function showEmptyState(show) {
  emptyState.classList.toggle('hidden', !show);
  streamersList.style.display = show ? 'none' : '';
}

function showLoading(show) {
  loadingState.style.display = show ? 'block' : 'none';
  streamersList.style.display = show ? 'none' : '';
}

function showError(message, isError = true) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  errorMessage.style.background = isError ? 'rgba(255, 82, 82, 0.1)' : 'rgba(250, 250, 250, 0.08)';
  errorMessage.style.borderColor = isError ? 'rgba(255, 82, 82, 0.3)' : 'rgba(250, 250, 250, 0.25)';
  errorMessage.style.color = isError ? '#FF5252' : '#FAFAFA';
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

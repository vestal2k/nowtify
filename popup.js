const streamerInput = document.getElementById('streamerInput');
const addBtn = document.getElementById('addBtn');
const settingsBtn = document.getElementById('settingsBtn');
const streamersList = document.getElementById('streamersList');
const emptyState = document.getElementById('emptyState');
const errorMessage = document.getElementById('errorMessage');
const loadingState = document.getElementById('loadingState');
const filtersBar = document.getElementById('filtersBar');
const compactBtn = document.getElementById('compactBtn');

let autocompleteTimeout = null;
let autocompleteList = null;
let currentStreamersMap = new Map(); // Track rendered streamers for diffing
let isInitialLoad = true;
let currentFilter = 'all';
let currentGroupFilter = '';
let allStreamersData = []; // Store all streamers for filtering
let allGroups = []; // Store groups for filtering
let isCompactMode = false;
let draggedElement = null;
let dragPlaceholder = null;
let customOrder = []; // Store custom order of streamer IDs
const groupFilterWrapper = document.getElementById('groupFilterWrapper');
const groupFilterBtn = document.getElementById('groupFilterBtn');
const groupFilterDropdown = document.getElementById('groupFilterDropdown');

document.addEventListener('DOMContentLoaded', async () => {
  await loadCustomOrder();
  await loadGroups();
  await loadStreamers();
  setupEventListeners();
  createAutocompleteList();
});

async function loadGroups() {
  const { groups = [], streamers = [] } = await chrome.storage.sync.get(['groups', 'streamers']);
  allGroups = groups;

  // Get unique teams from streamers (Twitch teams)
  const teamsSet = new Set();
  streamers.forEach(s => {
    if (s.team) teamsSet.add(s.team);
  });
  const teams = Array.from(teamsSet).sort();

  // Build dropdown content
  let dropdownHTML = '';

  // Clear filter option
  dropdownHTML += '<div class="filter-group-dropdown-item clear-filter" data-value="">Tous les groupes</div>';

  // Add custom groups
  if (groups.length > 0) {
    dropdownHTML += '<div class="filter-group-dropdown-label">Groupes</div>';
    groups.forEach(group => {
      dropdownHTML += `<div class="filter-group-dropdown-item" data-value="group:${group.id}">${escapeHtml(group.name)}</div>`;
    });
  }

  // Add Twitch teams
  if (teams.length > 0) {
    dropdownHTML += '<div class="filter-group-dropdown-label">Teams</div>';
    teams.forEach(teamName => {
      dropdownHTML += `<div class="filter-group-dropdown-item" data-value="team:${teamName}">${escapeHtml(capitalizeTeamName(teamName))}</div>`;
    });
  }

  groupFilterDropdown.innerHTML = dropdownHTML;

  // Hide the filter button if no groups/teams
  if (groups.length === 0 && teams.length === 0) {
    groupFilterWrapper.style.display = 'none';
  } else {
    groupFilterWrapper.style.display = 'block';
  }
}

async function loadCustomOrder() {
  const { streamerOrder = [] } = await chrome.storage.sync.get('streamerOrder');
  customOrder = streamerOrder;
}

function sortStreamers(streamersData) {
  // If we have a custom order, use it (but still keep live streamers grouped at top)
  if (customOrder.length > 0) {
    const orderMap = new Map(customOrder.map((id, index) => [id, index]));

    return [...streamersData].sort((a, b) => {
      // Live streamers always come first
      if (a.isLive !== b.isLive) return b.isLive - a.isLive;
      // Within same live status, use custom order
      const orderA = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
      const orderB = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
      if (orderA !== orderB) return orderA - orderB;
      // Fallback to recently live
      if (a.wasLiveRecently !== b.wasLiveRecently) return b.wasLiveRecently - a.wasLiveRecently;
      return 0;
    });
  }

  // Default sort: live first, then recently live, then offline
  return [...streamersData].sort((a, b) => {
    if (a.isLive !== b.isLive) return b.isLive - a.isLive;
    if (a.wasLiveRecently !== b.wasLiveRecently) return b.wasLiveRecently - a.wasLiveRecently;
    return 0;
  });
}

async function saveCustomOrder() {
  const cards = streamersList.querySelectorAll('.streamer-card:not(.skeleton):not(.drag-placeholder)');
  customOrder = Array.from(cards).map(card => card.dataset.streamerId);
  await chrome.storage.sync.set({ streamerOrder: customOrder });
}

// Drag & Drop handlers
function handleDragStart(e) {
  draggedElement = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.streamerId);

  // Create placeholder
  dragPlaceholder = document.createElement('div');
  dragPlaceholder.className = 'drag-placeholder';
  dragPlaceholder.style.height = this.offsetHeight + 'px';

  // Slight delay to allow drag image to be captured
  setTimeout(() => {
    this.style.opacity = '0.4';
  }, 0);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  this.classList.remove('drag-ready');
  this.style.opacity = '1';
  this.draggable = false;

  // Remove placeholder if exists
  if (dragPlaceholder && dragPlaceholder.parentNode) {
    dragPlaceholder.parentNode.removeChild(dragPlaceholder);
  }

  // Remove drag-over class from all cards
  document.querySelectorAll('.streamer-card.drag-over').forEach(card => {
    card.classList.remove('drag-over');
  });

  draggedElement = null;
  dragPlaceholder = null;

  // Save the new order
  saveCustomOrder();
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (!draggedElement || this === draggedElement) return;

  const rect = this.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;

  // Determine if we should place before or after
  if (e.clientY < midY) {
    streamersList.insertBefore(dragPlaceholder, this);
  } else {
    streamersList.insertBefore(dragPlaceholder, this.nextSibling);
  }
}

function handleDragEnter(e) {
  e.preventDefault();
  if (this !== draggedElement) {
    this.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  if (!draggedElement || this === draggedElement) return;

  this.classList.remove('drag-over');

  // Insert the dragged element at the placeholder position
  if (dragPlaceholder && dragPlaceholder.parentNode) {
    streamersList.insertBefore(draggedElement, dragPlaceholder);
  }
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

  // Filter buttons
  filtersBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    const filter = btn.dataset.filter;
    if (filter === currentFilter) return;

    // Update active state
    filtersBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = filter;

    // Apply filter
    applyFilter();
  });

  // Compact mode toggle
  compactBtn.addEventListener('click', () => {
    isCompactMode = !isCompactMode;
    compactBtn.classList.toggle('active', isCompactMode);
    streamersList.classList.toggle('compact', isCompactMode);

    // Save preference
    chrome.storage.sync.get('settings', ({ settings = {} }) => {
      settings.compactMode = isCompactMode;
      chrome.storage.sync.set({ settings });
    });
  });

  // Load compact mode preference
  chrome.storage.sync.get('settings', ({ settings = {} }) => {
    if (settings.compactMode) {
      isCompactMode = true;
      compactBtn.classList.add('active');
      streamersList.classList.add('compact');
    }
  });

  // Group filter dropdown
  groupFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    groupFilterWrapper.classList.toggle('open');
  });

  groupFilterDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.filter-group-dropdown-item');
    if (!item) return;

    const value = item.dataset.value;
    currentGroupFilter = value;

    // Update selected state
    groupFilterDropdown.querySelectorAll('.filter-group-dropdown-item').forEach(i => {
      i.classList.toggle('selected', i.dataset.value === value);
    });

    // Update button state
    groupFilterBtn.classList.toggle('active', value !== '');

    // Close dropdown
    groupFilterWrapper.classList.remove('open');

    applyFilter();
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!groupFilterWrapper.contains(e.target)) {
      groupFilterWrapper.classList.remove('open');
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
    // Show "no results" message for this filter
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

  // Apply platform/live filter
  if (filter !== 'all') {
    filtered = filtered.filter(s => {
      if (filter === 'live') return s.isLive;
      if (filter === 'twitch') return s.platform === 'twitch';
      if (filter === 'youtube') return s.platform === 'youtube';
      if (filter === 'kick') return s.platform === 'kick';
      return true;
    });
  }

  // Apply group/team filter
  if (currentGroupFilter) {
    if (currentGroupFilter.startsWith('group:')) {
      const groupId = currentGroupFilter.replace('group:', '');
      filtered = filtered.filter(s => s.group === groupId);
    } else if (currentGroupFilter.startsWith('team:')) {
      const teamName = currentGroupFilter.replace('team:', '');
      filtered = filtered.filter(s => s.team === teamName);
    }
  }

  return filtered;
}

async function loadStreamers() {
  try {
    const { streamers = [] } = await chrome.storage.sync.get('streamers');

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

    // Show skeletons only on initial load
    if (isInitialLoad) {
      showSkeletons(streamers.length);
    }

    // Save scroll position before update
    const scrollTop = document.body.scrollTop || document.documentElement.scrollTop;

    chrome.runtime.sendMessage({ action: 'getStreamersData' }, (response) => {
      const streamersData = (response && response.streamers) ? response.streamers : streamers;

      // Sort streamers based on custom order or default (live first)
      const sortedStreamers = sortStreamers(streamersData);

      // Store all streamers for filtering
      allStreamersData = sortedStreamers;

      // Apply current filter
      const filteredStreamers = filterStreamers(sortedStreamers, currentFilter);

      if (filteredStreamers.length === 0 && sortedStreamers.length > 0) {
        streamersList.innerHTML = '<div class="no-filter-results">Aucun streamer ne correspond à ce filtre</div>';
      } else {
        // Apply diff update
        updateStreamersWithDiff(filteredStreamers);
      }

      showLoading(false);
      isInitialLoad = false;

      // Restore scroll position
      requestAnimationFrame(() => {
        document.body.scrollTop = scrollTop;
        document.documentElement.scrollTop = scrollTop;
      });
    });
  } catch (error) {
    showError('Erreur lors du chargement');
    showLoading(false);
  }
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

  // Remove streamers that are no longer in the list
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

  // Clear skeletons if any
  const skeletons = streamersList.querySelectorAll('.skeleton');
  skeletons.forEach(s => s.remove());

  // Update or add streamers
  newStreamers.forEach((streamer, index) => {
    const existingData = currentStreamersMap.get(streamer.id);
    const existingCard = streamersList.querySelector(`[data-streamer-id="${streamer.id}"]`);

    if (existingCard && existingData) {
      // Update existing card if data changed
      if (hasStreamerChanged(existingData, streamer)) {
        updateStreamerCard(existingCard, existingData, streamer);
      }
      // Reorder if needed
      const currentIndex = Array.from(streamersList.children).indexOf(existingCard);
      if (currentIndex !== index) {
        const referenceNode = streamersList.children[index];
        if (referenceNode !== existingCard) {
          streamersList.insertBefore(existingCard, referenceNode);
        }
      }
    } else {
      // Create new card
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
         oldData.game !== newData.game;
}

function updateStreamerCard(card, oldData, newData) {
  // Handle live status change with animation
  if (oldData.isLive !== newData.isLive) {
    if (newData.isLive) {
      card.classList.add('going-live');
      setTimeout(() => {
        card.classList.remove('going-live');
        card.classList.add('live');
        card.classList.remove('ended');
      }, 50);
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

  // Update ended state
  if (!newData.isLive && newData.wasLiveRecently && !card.classList.contains('ended')) {
    card.classList.add('ended');
  } else if (!newData.wasLiveRecently && card.classList.contains('ended')) {
    card.classList.remove('ended');
  }

  // Update status indicator
  const statusIndicator = card.querySelector('.status-indicator');
  const statusDot = card.querySelector('.status-dot');
  if (statusIndicator && statusDot) {
    const statusText = getStatusText(newData);
    const statusClass = newData.isLive ? 'live' : (newData.wasLiveRecently ? 'recent' : 'offline');

    statusIndicator.className = `status-indicator ${statusClass}`;
    statusDot.className = `status-dot ${statusClass}`;

    // Update text content smoothly
    const textNode = statusIndicator.childNodes[statusIndicator.childNodes.length - 1];
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = statusText;
    } else {
      statusIndicator.innerHTML = `<span class="status-dot ${statusClass}"></span>${statusText}`;
    }
  }

  // Update title if changed
  if (oldData.title !== newData.title) {
    const titleEl = card.querySelector('.streamer-title');
    if (titleEl && newData.title) {
      titleEl.textContent = newData.title;
      titleEl.title = newData.title;
    }
  }

  // Update avatar if changed
  if (oldData.avatar !== newData.avatar && newData.avatar) {
    const avatarEl = card.querySelector('.streamer-avatar');
    if (avatarEl) {
      avatarEl.src = newData.avatar;
    }
  }

  // Update stream preview
  const existingPreview = card.querySelector('.stream-preview');
  if (newData.isLive && newData.thumbnail) {
    if (existingPreview) {
      // Update existing preview
      const thumbnailEl = existingPreview.querySelector('.stream-preview-thumbnail');
      if (thumbnailEl) thumbnailEl.src = newData.thumbnail;

      const gameEl = existingPreview.querySelector('.stream-preview-game');
      if (gameEl) {
        const gameIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13h4m-2-2v4m3 1h.01M17 16h.01M2 12V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z"/></svg>`;
        gameEl.innerHTML = `${gameIcon} ${escapeHtml(newData.game || 'Stream en cours')}`;
      }

      const viewersEl = existingPreview.querySelector('.stream-preview-viewers');
      if (newData.viewerCount) {
        const viewersIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
        if (viewersEl) {
          viewersEl.innerHTML = `${viewersIcon} ${formatViewers(newData.viewerCount)} spectateurs`;
        } else {
          const infoEl = existingPreview.querySelector('.stream-preview-info');
          if (infoEl) {
            const viewersDiv = document.createElement('div');
            viewersDiv.className = 'stream-preview-viewers';
            viewersDiv.innerHTML = `${viewersIcon} ${formatViewers(newData.viewerCount)} spectateurs`;
            infoEl.appendChild(viewersDiv);
          }
        }
      }
    } else {
      // Add new preview
      const preview = createStreamPreview(newData);
      card.appendChild(preview);
    }
  } else if (existingPreview) {
    // Remove preview when going offline
    existingPreview.remove();
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
    img.src = result.avatar || 'icons/avatars/default.svg';
    img.alt = result.name;
    img.className = 'autocomplete-avatar';
    img.addEventListener('error', () => {
      img.src = 'icons/avatars/default.svg';
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

function createStreamerCard(streamer) {
  const card = document.createElement('div');
  const isRecent = streamer.wasLiveRecently && !streamer.isLive;
  card.className = `streamer-card ${streamer.isLive ? 'live' : ''} ${isRecent ? 'ended' : ''}`;
  card.dataset.streamerId = streamer.id;
  // Drag will be enabled/disabled via the drag handle
  card.draggable = false;
  card.style.opacity = '0';
  card.style.transform = 'translateX(-20px)';
  
  const statusText = getStatusText(streamer);
  const statusClass = streamer.isLive ? 'live' : (streamer.wasLiveRecently ? 'recent' : 'offline');
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
      <span class="platform-icon platform-${streamer.platform}" title="${streamer.platform}">
        ${platformIcon}
      </span>
      <div class="streamer-name" title="${escapeHtml(streamer.name)}">${escapeHtml(streamer.name)}</div>
      <span class="status-indicator ${statusClass}">
        <span class="status-dot ${statusClass}"></span>
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
  
  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.title = 'Déplacer';
  dragHandle.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="5" r="1"></circle>
      <circle cx="9" cy="12" r="1"></circle>
      <circle cx="9" cy="19" r="1"></circle>
      <circle cx="15" cy="5" r="1"></circle>
      <circle cx="15" cy="12" r="1"></circle>
      <circle cx="15" cy="19" r="1"></circle>
    </svg>
  `;

  // Enable drag only when mousedown on handle
  dragHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    card.draggable = true;
    card.classList.add('drag-ready');
  });

  // Disable drag on mouseup anywhere
  dragHandle.addEventListener('mouseup', () => {
    setTimeout(() => {
      card.draggable = false;
      card.classList.remove('drag-ready');
    }, 100);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.title = 'Supprimer';
  deleteBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  card.appendChild(dragHandle);
  card.appendChild(img);
  card.appendChild(infoDiv);
  card.appendChild(deleteBtn);

  // Add stream preview for live streamers with thumbnail
  if (streamer.isLive && streamer.thumbnail) {
    const preview = createStreamPreview(streamer);
    card.appendChild(preview);
  }

  setTimeout(() => {
    card.style.transition = 'all 0.3s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateX(0)';
  }, 50);

  // Mouse follow effect for gradient
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty('--mouse-x', x + '%');
    card.style.setProperty('--mouse-y', y + '%');
  });

  card.addEventListener('click', (e) => {
    if (!e.target.closest('.delete-btn') && !e.target.closest('.drag-handle')) {
      openStream(streamer);
    }
  });

  // Drag & Drop events
  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend', handleDragEnd);
  card.addEventListener('dragover', handleDragOver);
  card.addEventListener('dragenter', handleDragEnter);
  card.addEventListener('dragleave', handleDragLeave);
  card.addEventListener('drop', handleDrop);

  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    const { settings = {} } = await chrome.storage.sync.get('settings');
    const shouldConfirm = settings.confirmDelete !== false;

    if (streamer.team) {
      // Give user choice: delete just this streamer OR the entire team
      if (!shouldConfirm) {
        await deleteStreamer(streamer.id, card);
      } else {
        showDeleteTeamModal(streamer, card);
      }
    } else {
      if (!shouldConfirm || confirm(`Supprimer ${streamer.name} ?`)) {
        await deleteStreamer(streamer.id, card);
      }
    }
  });

  return card;
}

function capitalizeTeamName(teamName) {
  return teamName.charAt(0).toUpperCase() + teamName.slice(1).toLowerCase();
}

function createStreamPreview(streamer) {
  const preview = document.createElement('div');
  preview.className = 'stream-preview';

  const gameIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13h4m-2-2v4m3 1h.01M17 16h.01M2 12V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z"/></svg>`;
  const viewersIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

  const gameText = streamer.game ? escapeHtml(streamer.game) : 'Stream en cours';
  const viewersText = streamer.viewerCount ? formatViewers(streamer.viewerCount) + ' spectateurs' : '';

  preview.innerHTML = `
    <div class="stream-preview-live-badge">Live</div>
    <img src="${streamer.thumbnail}" alt="Stream preview" class="stream-preview-thumbnail" onerror="this.style.display='none'">
    <div class="stream-preview-info">
      <div class="stream-preview-game">${gameIcon} ${gameText}</div>
      ${viewersText ? `<div class="stream-preview-viewers">${viewersIcon} ${viewersText}</div>` : ''}
    </div>
  `;

  return preview;
}

function getStatusText(streamer) {
  if (streamer.isLive) {
    return streamer.viewerCount ? formatViewers(streamer.viewerCount) : 'Live';
  }
  if (streamer.lastLiveDate && !streamer.isLive) {
    const hoursSince = Math.floor((Date.now() - streamer.lastLiveDate) / (1000 * 60 * 60));
    if (hoursSince < 24) {
      return hoursSince === 0 ? '< 1h' : `${hoursSince}h`;
    }
  }
  if (streamer.wasLiveRecently && streamer.lastLiveDate) {
    const hoursSince = Math.floor((Date.now() - streamer.lastLiveDate) / (1000 * 60 * 60));
    return hoursSince === 0 ? '< 1h' : `${hoursSince}h`;
  }
  return 'Offline';
}

function formatViewers(count) {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}

async function deleteStreamer(id, cardElement) {
  try {
    cardElement.classList.add('removing');
    cardElement.style.transition = 'all 0.3s ease';
    cardElement.style.opacity = '0';
    cardElement.style.transform = 'translateX(20px)';

    currentStreamersMap.delete(id);

    setTimeout(async () => {
      cardElement.remove();
      const { streamers = [] } = await chrome.storage.sync.get('streamers');
      const filtered = streamers.filter(s => s.id !== id);
      await chrome.storage.sync.set({ streamers: filtered });

      // Check if list is now empty
      if (filtered.length === 0) {
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
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    const filtered = streamers.filter(s => s.team !== teamName);
    await chrome.storage.sync.set({ streamers: filtered });
    await loadStreamers();
  } catch (error) {
    showError('Erreur lors de la suppression de la team');
  }
}

function showDeleteTeamModal(streamer, cardElement) {
  // Remove existing modal if any
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

  // Event listeners
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
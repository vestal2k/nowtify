// background.js - Service worker pour la logique de polling et notifications

// Configuration des API (chargées dynamiquement depuis le storage)
// IMPORTANT: Les clés Twitch s'obtiennent sur https://dev.twitch.tv/console/apps
// - Client ID: Identifiant public de votre application
// - Client Secret: Clé secrète pour générer les tokens OAuth (NE PAS partager)
// Ces deux clés permettent de générer automatiquement un "App Access Token"
let CONFIG = {
  TWITCH_CLIENT_ID: '',
  TWITCH_CLIENT_SECRET: '',
  YOUTUBE_API_KEY: '',
  CHECK_INTERVAL_FAST: 30 * 1000,
  CHECK_INTERVAL_NORMAL: 3 * 60 * 1000,
  CHECK_INTERVAL_SLOW: 5 * 60 * 1000,
  RECENT_LIVE_THRESHOLD: 12 * 60 * 60 * 1000
};

let streamersCache = {};
let isChecking = false;
let adaptiveTimers = {};
let lastCheck = {};

// Installation de l'extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Nowtify installé !');
  
  await loadApiKeys();
  
  const { streamers } = await chrome.storage.sync.get('streamers');
  if (!streamers) {
    await chrome.storage.sync.set({ 
      streamers: [],
      settings: {
        notifications: true,
        autoRefresh: true,
        theme: 'dark',
        refreshInterval: '5'
      }
    });
  }

  chrome.alarms.create('checkStreams', { periodInMinutes: 0.5 });
  setTimeout(() => checkAllStreamers(), 2000);
});

// Démarrage du service worker
chrome.runtime.onStartup.addListener(async () => {
  await loadApiKeys();
  checkAllStreamers();
});

// Charger les clés API depuis le storage
async function loadApiKeys() {
  try {
    const { apiKeys = {} } = await chrome.storage.sync.get('apiKeys');
    CONFIG.TWITCH_CLIENT_ID = apiKeys.twitchClientId || '';
    CONFIG.TWITCH_CLIENT_SECRET = apiKeys.twitchClientSecret || '';
    CONFIG.YOUTUBE_API_KEY = apiKeys.youtubeApiKey || '';
  } catch (error) {
    console.error('Erreur chargement clés API:', error);
  }
}

// Écouter les alarmes
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkStreams') {
    checkAllStreamers();
  }
});

// Écouter les messages de la popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkNow') {
    checkAllStreamers().then(() => sendResponse({ success: true }));
    return true;
  }
  
  if (request.action === 'getStreamersData') {
    getStreamersWithData().then(data => sendResponse({ streamers: data }));
    return true;
  }

  if (request.action === 'settingsUpdated') {
    if (request.apiKeys) {
      CONFIG.TWITCH_CLIENT_ID = request.apiKeys.twitchClientId || '';
      CONFIG.TWITCH_CLIENT_SECRET = request.apiKeys.twitchClientSecret || '';
      CONFIG.YOUTUBE_API_KEY = request.apiKeys.youtubeApiKey || '';
      // Supprimer le token pour forcer le refresh
      chrome.storage.local.remove('twitchToken');
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'updateAlarm') {
    chrome.alarms.clear('checkStreams', () => {
      chrome.alarms.create('checkStreams', { 
        periodInMinutes: request.minutes 
      });
    });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'searchStreamers') {
    searchStreamers(request.query).then(results => {
      sendResponse({ results });
    }).catch(error => {
      console.error('Erreur searchStreamers:', error);
      sendResponse({ results: [] });
    });
    return true;
  }

  if (request.action === 'searchTeams') {
    searchTwitchTeams(request.query).then(results => {
      sendResponse({ results });
    }).catch(error => {
      console.error('Erreur searchTeams:', error);
      sendResponse({ results: [] });
    });
    return true;
  }

  if (request.action === 'addTwitchTeam') {
    addTwitchTeam(request.teamName).then(result => {
      sendResponse(result);
    }).catch(error => {
      console.error('Erreur addTwitchTeam:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

async function searchTwitchTeams(query) {
  if (!query || query.length < 2) return [];

  try {
    const token = await getTwitchToken();
    if (!token) return [];

    const response = await fetch(
      `https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(query)}&first=5`,
      {
        headers: {
          'Client-ID': CONFIG.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.ok) {
      const knownTeams = [
        { name: 'solary', display_name: 'Solary' },
        { name: 'koi', display_name: 'KOI' },
        { name: 'karminecorp', display_name: 'Karmine Corp' },
        { name: 'mandatory', display_name: 'Mandatory' },
        { name: 'ogaming', display_name: 'O\'Gaming' }
      ];

      return knownTeams.filter(team => 
        team.name.toLowerCase().includes(query.toLowerCase()) ||
        team.display_name.toLowerCase().includes(query.toLowerCase())
      );
    }
    
    return [];
  } catch (error) {
    console.error('Erreur recherche teams:', error);
    return [];
  }
}

async function addTwitchTeam(teamName) {
  try {
    const token = await getTwitchToken();
    if (!token) {
      return { success: false, error: 'Token Twitch manquant' };
    }

    const response = await fetch(`https://api.twitch.tv/helix/teams?name=${teamName}`, {
      headers: {
        'Client-ID': CONFIG.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return { success: false, error: 'Team introuvable' };
    }

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      return { success: false, error: 'Team introuvable' };
    }

    const team = data.data[0];
    const teamUsers = team.users || [];

    if (teamUsers.length === 0) {
      return { success: false, error: 'Aucun membre dans cette team' };
    }

    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    let addedCount = 0;

    for (const user of teamUsers) {
      const exists = streamers.some(s => 
        s.platform === 'twitch' && s.username.toLowerCase() === user.user_login.toLowerCase()
      );

      if (!exists) {
        const newStreamer = {
          id: `twitch_${user.user_login}_${Date.now()}_${addedCount}`,
          name: user.user_name,
          username: user.user_login,
          platform: 'twitch',
          avatar: user.thumbnail_url || '',
          isLive: false,
          wasLiveRecently: false,
          team: teamName,
          addedDate: Date.now(),
          priority: 'high'
        };
        streamers.push(newStreamer);
        addedCount++;
      }
    }

    await chrome.storage.sync.set({ streamers });
    checkAllStreamers();

    return { success: true, count: addedCount };
  } catch (error) {
    console.error('Erreur team:', error);
    return { success: false, error: error.message };
  }
}

async function checkAllStreamers() {
  if (isChecking) {
    return;
  }

  try {
    isChecking = true;
    await loadApiKeys();
    
    const { streamers = [], settings = {} } = await chrome.storage.sync.get(['streamers', 'settings']);
    
    if (streamers.length === 0) {
      updateBadgeAndIcon(false, 0);
      isChecking = false;
      return;
    }

    const updatedStreamers = [];
    let liveCount = 0;

    for (const streamer of streamers) {
      try {
        const data = await checkStreamerStatus(streamer);
        
        if (!data.avatar || data.avatar === '') {
          data.avatar = await getStreamerAvatar(streamer.platform, streamer.username);
        }
        
        const updated = { ...streamer, ...data };
        
        if (data.isLive && !streamer.isLive && settings.notifications !== false) {
          sendNotification(updated);
        }

        if (data.isLive) {
          liveCount++;
          updated.priority = 'high';
          scheduleAdaptiveCheck(updated.id, CONFIG.CHECK_INTERVAL_FAST);
        } else if (streamer.wasLiveRecently) {
          updated.priority = 'medium';
          scheduleAdaptiveCheck(updated.id, CONFIG.CHECK_INTERVAL_NORMAL);
        } else {
          updated.priority = 'normal';
          scheduleAdaptiveCheck(updated.id, CONFIG.CHECK_INTERVAL_SLOW);
        }
        
        lastCheck[streamer.id] = Date.now();
        
        updatedStreamers.push(updated);
        streamersCache[streamer.id] = updated;
      } catch (error) {
        console.error(`Erreur pour ${streamer.name}:`, error);
        updatedStreamers.push(streamer);
      }
    }

    updateBadgeAndIcon(liveCount > 0, liveCount);
    await chrome.storage.sync.set({ streamers: updatedStreamers });

  } catch (error) {
    console.error('Erreur lors de la vérification:', error);
  } finally {
    isChecking = false;
  }
}

function scheduleAdaptiveCheck(streamerId, interval) {
  if (adaptiveTimers[streamerId]) {
    clearTimeout(adaptiveTimers[streamerId]);
  }

  const timeSinceLastCheck = lastCheck[streamerId] ? Date.now() - lastCheck[streamerId] : interval;
  if (timeSinceLastCheck < interval * 0.5) {
    return;
  }

  adaptiveTimers[streamerId] = setTimeout(async () => {
    const { streamers = [], settings = {} } = await chrome.storage.sync.get(['streamers', 'settings']);
    const streamer = streamers.find(s => s.id === streamerId);
    
    if (streamer) {
      try {
        const data = await checkStreamerStatus(streamer);
        const updated = { ...streamer, ...data };
        
        if (data.isLive && !streamer.isLive && settings.notifications !== false) {
          sendNotification(updated);
        }
        
        const index = streamers.findIndex(s => s.id === streamerId);
        if (index !== -1) {
          streamers[index] = updated;
          await chrome.storage.sync.set({ streamers });
          streamersCache[streamerId] = updated;
          lastCheck[streamerId] = Date.now();
        }
        
        const nextInterval = data.isLive ? CONFIG.CHECK_INTERVAL_FAST : 
                            updated.wasLiveRecently ? CONFIG.CHECK_INTERVAL_NORMAL : 
                            CONFIG.CHECK_INTERVAL_SLOW;
        scheduleAdaptiveCheck(streamerId, nextInterval);
      } catch (error) {
        console.error(`Erreur check adaptatif pour ${streamer.name}:`, error);
      }
    }
  }, interval);
}

async function checkStreamerStatus(streamer) {
  try {
    switch (streamer.platform) {
      case 'twitch':
        return await checkTwitchStatus(streamer.username);
      case 'youtube':
        return await checkYouTubeStatus(streamer.username);
      case 'kick':
        return await checkKickStatus(streamer.username);
      default:
        return { isLive: false };
    }
  } catch (error) {
    console.error(`Erreur pour ${streamer.name}:`, error);
    return { isLive: false, error: true };
  }
}

async function checkTwitchStatus(username) {
  try {
    if (!CONFIG.TWITCH_CLIENT_ID) {
      return { isLive: false, error: true };
    }

    const token = await getTwitchToken();
    if (!token) {
      return { isLive: false, error: true };
    }

    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
      headers: {
        'Client-ID': CONFIG.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        await chrome.storage.local.remove('twitchToken');
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const stream = data.data[0];

    if (stream) {
      return {
        isLive: true,
        title: stream.title,
        game: stream.game_name,
        viewerCount: stream.viewer_count,
        thumbnail: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
        startedAt: new Date(stream.started_at).getTime(),
        lastLiveDate: Date.now()
      };
    }

    return { isLive: false };
  } catch (error) {
    console.error('Erreur Twitch:', error);
    return { isLive: false, error: true };
  }
}

async function getTwitchToken() {
  try {
    const { twitchToken } = await chrome.storage.local.get('twitchToken');
    
    if (twitchToken && twitchToken.expiresAt > Date.now() + 60000) {
      return twitchToken.access_token;
    }

    if (!CONFIG.TWITCH_CLIENT_SECRET) {
      console.warn('Client Secret Twitch manquant');
      return null;
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${CONFIG.TWITCH_CLIENT_ID}&client_secret=${CONFIG.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    });

    if (!response.ok) {
      console.error('Erreur obtention token:', response.status);
      const errorData = await response.json().catch(() => ({}));
      console.error('Détails erreur:', errorData);
      return null;
    }

    const data = await response.json();
    
    await chrome.storage.local.set({
      twitchToken: {
        access_token: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000)
      }
    });

    return data.access_token;
  } catch (error) {
    console.error('Erreur obtention token Twitch:', error);
    return null;
  }
}

async function checkYouTubeStatus(username) {
  try {
    if (!CONFIG.YOUTUBE_API_KEY) {
      return { isLive: false, error: true };
    }

    let channelId = username;
    
    if (username.startsWith('@') || !username.startsWith('UC')) {
      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&maxResults=1&key=${CONFIG.YOUTUBE_API_KEY}`
      );
      
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.items && searchData.items[0]) {
          channelId = searchData.items[0].snippet.channelId;
        }
      }
    }

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${CONFIG.YOUTUBE_API_KEY}`
    );

    if (!response.ok) {
      throw new Error('Erreur API YouTube');
    }

    const data = await response.json();

    if (data.items && data.items.length > 0) {
      const video = data.items[0];
      
      const detailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,snippet&id=${video.id.videoId}&key=${CONFIG.YOUTUBE_API_KEY}`
      );
      const detailsData = await detailsResponse.json();
      const details = detailsData.items[0];

      return {
        isLive: true,
        title: details.snippet.title,
        thumbnail: details.snippet.thumbnails.medium.url,
        viewerCount: parseInt(details.liveStreamingDetails.concurrentViewers || 0),
        startedAt: new Date(details.liveStreamingDetails.actualStartTime).getTime(),
        lastLiveDate: Date.now()
      };
    }

    return { isLive: false };
  } catch (error) {
    console.error('Erreur YouTube:', error);
    return { isLive: false, error: true };
  }
}

async function checkKickStatus(username) {
  try {
    const response = await fetch(`https://kick.com/api/v1/channels/${username}`);
    
    if (!response.ok) {
      throw new Error('Erreur API Kick');
    }

    const data = await response.json();

    if (data.livestream) {
      return {
        isLive: true,
        title: data.livestream.session_title || 'Sans titre',
        thumbnail: data.livestream.thumbnail?.url || data.user?.profile_pic,
        viewerCount: data.livestream.viewer_count || 0,
        startedAt: new Date(data.livestream.created_at).getTime(),
        lastLiveDate: Date.now()
      };
    }

    return { isLive: false };
  } catch (error) {
    console.error('Erreur Kick:', error);
    return { isLive: false, error: true };
  }
}

async function getStreamerAvatar(platform, username) {
  try {
    switch (platform) {
      case 'twitch':
        const token = await getTwitchToken();
        if (!token) return '';
        
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
          headers: {
            'Client-ID': CONFIG.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          return data.data[0]?.profile_image_url || '';
        }
        return '';
        
      case 'youtube':
        if (!CONFIG.YOUTUBE_API_KEY) return '';
        
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&maxResults=1&key=${CONFIG.YOUTUBE_API_KEY}`;
        const ytResponse = await fetch(searchUrl);
        
        if (ytResponse.ok) {
          const ytData = await ytResponse.json();
          if (ytData.items && ytData.items[0]) {
            return ytData.items[0].snippet.thumbnails.default?.url || '';
          }
        }
        return '';
        
      case 'kick':
        const kickResponse = await fetch(`https://kick.com/api/v1/channels/${username}`);
        if (kickResponse.ok) {
          const kickData = await kickResponse.json();
          return kickData.user?.profile_pic || '';
        }
        return '';
        
      default:
        return '';
    }
  } catch (error) {
    console.error('Erreur récupération avatar:', error);
    return '';
  }
}

async function searchStreamers(query) {
  if (!query || query.length < 2) return [];

  try {
    const token = await getTwitchToken();
    if (!token) return [];

    const response = await fetch(
      `https://api.twitch.tv/helix/search/channels?query=${encodeURIComponent(query)}&first=5`,
      {
        headers: {
          'Client-ID': CONFIG.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.data.map(channel => ({
        name: channel.display_name,
        username: channel.broadcaster_login,
        avatar: channel.thumbnail_url,
        platform: 'twitch',
        isLive: channel.is_live
      }));
    }
    
    return [];
  } catch (error) {
    console.error('Erreur recherche:', error);
    return [];
  }
}

async function getStreamersWithData() {
  const { streamers = [] } = await chrome.storage.sync.get('streamers');
  
  const enriched = await Promise.all(streamers.map(async (streamer) => {
    const cached = streamersCache[streamer.id];
    if (cached && cached._cacheTime && (Date.now() - cached._cacheTime < 30000)) {
      return cached;
    }

    if (!streamer.avatar) {
      streamer.avatar = await getStreamerAvatar(streamer.platform, streamer.username);
    }

    if (streamer.lastLiveDate) {
      const timeSince = Date.now() - streamer.lastLiveDate;
      streamer.wasLiveRecently = timeSince < CONFIG.RECENT_LIVE_THRESHOLD;
    }

    streamer._cacheTime = Date.now();
    streamersCache[streamer.id] = streamer;

    return streamer;
  }));

  return enriched;
}

function updateBadgeAndIcon(hasLive, liveCount = 0) {
  if (hasLive && liveCount > 0) {
    chrome.action.setBadgeText({ text: liveCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#5CFFE0' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function sendNotification(streamer) {
  const notificationId = `live-${streamer.id}-${Date.now()}`;
  
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: streamer.avatar || 'icons/icon128.png',
    title: `🔴 ${streamer.name} est en live !`,
    message: streamer.title || `${streamer.name} vient de commencer un stream sur ${streamer.platform}`,
    priority: 2,
    requireInteraction: false
  });

  const clickHandler = (clickedId) => {
    if (clickedId === notificationId) {
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
      chrome.notifications.onClicked.removeListener(clickHandler);
    }
  };

  chrome.notifications.onClicked.addListener(clickHandler);
  saveToHistory(streamer);
}

async function saveToHistory(streamer) {
  const { history = [] } = await chrome.storage.local.get('history');
  
  history.unshift({
    streamerId: streamer.id,
    name: streamer.name,
    platform: streamer.platform,
    title: streamer.title,
    timestamp: Date.now()
  });

  const trimmed = history.slice(0, 50);
  await chrome.storage.local.set({ history: trimmed });
}

loadApiKeys().then(() => {
  checkAllStreamers();
});

// Vérifier tous les streamers
async function checkAllStreamers() {
  if (isChecking) {
    return;
  }

  try {
    isChecking = true;
    await loadApiKeys();
    
    const { streamers = [], settings = {} } = await chrome.storage.sync.get(['streamers', 'settings']);
    
    if (streamers.length === 0) {
      updateBadgeAndIcon(false, 0);
      isChecking = false;
      return;
    }

    const updatedStreamers = [];
    let liveCount = 0;

    for (const streamer of streamers) {
      try {
        const data = await checkStreamerStatus(streamer);
        
        // Récupérer l'avatar si manquant
        if (!data.avatar || data.avatar === '') {
          data.avatar = await getStreamerAvatar(streamer.platform, streamer.username);
        }
        
        const updated = { ...streamer, ...data };
        
        // Vérifier si nouveau live
        if (data.isLive && !streamer.isLive && settings.notifications !== false) {
          sendNotification(updated);
        }
        
        if (data.isLive) {
          liveCount++;
        }
        
        updatedStreamers.push(updated);
        streamersCache[streamer.id] = updated;
      } catch (error) {
        console.error(`Erreur pour ${streamer.name}:`, error);
        updatedStreamers.push(streamer);
      }
    }

    updateBadgeAndIcon(liveCount > 0, liveCount);
    await chrome.storage.sync.set({ streamers: updatedStreamers });

  } catch (error) {
    console.error('Erreur lors de la vérification:', error);
  } finally {
    isChecking = false;
  }
}

// Vérifier le statut d'un streamer selon sa plateforme
async function checkStreamerStatus(streamer) {
  try {
    switch (streamer.platform) {
      case 'twitch':
        return await checkTwitchStatus(streamer.username);
      case 'youtube':
        return await checkYouTubeStatus(streamer.username);
      case 'kick':
        return await checkKickStatus(streamer.username);
      default:
        return { isLive: false };
    }
  } catch (error) {
    console.error(`Erreur pour ${streamer.name}:`, error);
    return { isLive: false, error: true };
  }
}

// Vérifier Twitch via Helix API
async function checkTwitchStatus(username) {
  try {
    if (!CONFIG.TWITCH_CLIENT_ID) {
      return { isLive: false, error: true };
    }

    const token = await getTwitchToken();
    if (!token) {
      return { isLive: false, error: true };
    }

    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
      headers: {
        'Client-ID': CONFIG.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        await chrome.storage.local.remove('twitchToken');
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const stream = data.data[0];

    if (stream) {
      return {
        isLive: true,
        title: stream.title,
        game: stream.game_name,
        viewerCount: stream.viewer_count,
        thumbnail: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
        startedAt: new Date(stream.started_at).getTime(),
        lastLiveDate: Date.now()
      };
    }

    return { isLive: false };
  } catch (error) {
    console.error('Erreur Twitch:', error);
    return { isLive: false, error: true };
  }
}

// Obtenir un token Twitch (App Access Token)
// Utilise le Client ID + Client Secret pour générer un token OAuth automatiquement
async function getTwitchToken() {
  try {
    const { twitchToken } = await chrome.storage.local.get('twitchToken');
    
    if (twitchToken && twitchToken.expiresAt > Date.now() + 60000) {
      return twitchToken.access_token;
    }

    if (!CONFIG.TWITCH_CLIENT_SECRET) {
      console.warn('Client Secret Twitch manquant');
      return null;
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${CONFIG.TWITCH_CLIENT_ID}&client_secret=${CONFIG.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    });

    if (!response.ok) {
      console.error('Erreur obtention token:', response.status);
      return null;
    }

    const data = await response.json();
    
    await chrome.storage.local.set({
      twitchToken: {
        access_token: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000)
      }
    });

    return data.access_token;
  } catch (error) {
    console.error('Erreur obtention token Twitch:', error);
    return null;
  }
}

// Écouter les alarmes
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkStreams') {
    checkAllStreamers();
  }
});

// Écouter les messages de la popup


// Recherche de streamers (auto-complétion)
async function searchStreamers(query, platform = 'twitch') {
  if (!query || query.length < 2) return [];

  try {
    if (platform === 'twitch') {
      const token = await getTwitchToken();
      if (!token) return [];

      const response = await fetch(
        `https://api.twitch.tv/helix/search/channels?query=${encodeURIComponent(query)}&first=5`,
        {
          headers: {
            'Client-ID': CONFIG.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        return data.data.map(channel => ({
          name: channel.display_name,
          username: channel.broadcaster_login,
          avatar: channel.thumbnail_url,
          platform: 'twitch',
          isLive: channel.is_live
        }));
      }
    }
    // TODO: Ajouter YouTube et Kick si nécessaire
    return [];
  } catch (error) {
    console.error('Erreur recherche:', error);
    return [];
  }
}

// Envoyer une notification
function sendNotification(streamer) {
  const notificationId = `live-${streamer.id}-${Date.now()}`;
  
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: streamer.avatar || 'icons/icon128.png',
    title: `🔴 ${streamer.name} est en live !`,
    message: streamer.title || `${streamer.name} vient de commencer un stream sur ${streamer.platform}`,
    priority: 2,
    requireInteraction: false
  });

  // Ouvrir le stream au clic
  const clickHandler = (clickedId) => {
    if (clickedId === notificationId) {
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
      chrome.notifications.onClicked.removeListener(clickHandler);
    }
  };

  chrome.notifications.onClicked.addListener(clickHandler);

  // Sauvegarder dans l'historique
  saveToHistory(streamer);
}

// Sauvegarder dans l'historique
async function saveToHistory(streamer) {
  const { history = [] } = await chrome.storage.local.get('history');
  
  history.unshift({
    streamerId: streamer.id,
    name: streamer.name,
    platform: streamer.platform,
    title: streamer.title,
    timestamp: Date.now()
  });

  // Garder seulement les 50 derniers
  const trimmed = history.slice(0, 50);
  
  await chrome.storage.local.set({ history: trimmed });
}

// Vérifier tous les streamers
async function checkAllStreamers() {
  if (isChecking) {
    console.log('Vérification déjà en cours, ignorée');
    return;
  }

  try {
    isChecking = true;
    await loadApiKeys(); // Recharger les clés au cas où
    
    const { streamers = [], settings = {} } = await chrome.storage.sync.get(['streamers', 'settings']);
    
    if (streamers.length === 0) {
      updateBadgeAndIcon(false);
      isChecking = false;
      return;
    }

    const updatedStreamers = [];
    let hasLiveStreamer = false;
    let liveCount = 0;

    for (const streamer of streamers) {
      try {
        const data = await checkStreamerStatus(streamer);
        
        // Récupérer l'avatar si manquant
        if (!data.avatar || data.avatar === '') {
          data.avatar = await getStreamerAvatar(streamer.platform, streamer.username);
        }
        
        const updated = { ...streamer, ...data };
        
        // Vérifier si nouveau live
        if (data.isLive && !streamer.isLive && settings.notifications !== false) {
          sendNotification(updated);
        }
        
        if (data.isLive) {
          hasLiveStreamer = true;
          liveCount++;
        }
        
        updatedStreamers.push(updated);
        streamersCache[streamer.id] = updated;
      } catch (error) {
        console.error(`Erreur pour ${streamer.name}:`, error);
        // Garder les anciennes données en cas d'erreur
        updatedStreamers.push(streamer);
      }
    }

    // Mettre à jour le badge et l'icône
    updateBadgeAndIcon(hasLiveStreamer, liveCount);

    // Sauvegarder les mises à jour
    await chrome.storage.sync.set({ streamers: updatedStreamers });

  } catch (error) {
    console.error('Erreur lors de la vérification:', error);
  } finally {
    isChecking = false;
  }
}

// Vérifier le statut d'un streamer selon sa plateforme
async function checkStreamerStatus(streamer) {
  try {
    switch (streamer.platform) {
      case 'twitch':
        return await checkTwitchStatus(streamer.username);
      case 'youtube':
        return await checkYouTubeStatus(streamer.username);
      case 'kick':
        return await checkKickStatus(streamer.username);
      default:
        return { isLive: false };
    }
  } catch (error) {
    console.error(`Erreur pour ${streamer.name}:`, error);
    return { isLive: false, error: true };
  }
}

// Vérifier Twitch via Helix API
async function checkTwitchStatus(username) {
  try {
    if (!CONFIG.TWITCH_CLIENT_ID) {
      console.warn('Client ID Twitch manquant');
      return { isLive: false, error: true };
    }

    // Obtenir le token d'accès
    const token = await getTwitchToken();
    
    if (!token) {
      console.error('Impossible d\'obtenir le token Twitch');
      return { isLive: false, error: true };
    }

    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
      headers: {
        'Client-ID': CONFIG.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      console.error('Erreur API Twitch:', response.status, response.statusText);
      // Si token invalide, le supprimer
      if (response.status === 401) {
        await chrome.storage.local.remove('twitchToken');
      }
      throw new Error('Erreur API Twitch');
    }

    const data = await response.json();
    const stream = data.data[0];

    if (stream) {
      return {
        isLive: true,
        title: stream.title,
        game: stream.game_name,
        viewerCount: stream.viewer_count,
        thumbnail: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
        startedAt: new Date(stream.started_at).getTime(),
        lastLiveDate: Date.now()
      };
    }

    return { isLive: false };
  } catch (error) {
    console.error('Erreur Twitch:', error);
    return { isLive: false, error: true };
  }
}

// Obtenir un token Twitch (OAuth simplifié)
async function getTwitchToken() {
  try {
    // Vérifier le token en cache
    const { twitchToken } = await chrome.storage.local.get('twitchToken');
    
    if (twitchToken && twitchToken.expiresAt > Date.now() + 60000) { // 1 min de marge
      return twitchToken.access_token;
    }

    // Obtenir un nouveau token (App Access Token)
    if (!CONFIG.TWITCH_CLIENT_SECRET) {
      console.warn('Client Secret Twitch manquant - token non disponible');
      return null;
    }

    console.log('Obtention d\'un nouveau token Twitch...');
    
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${CONFIG.TWITCH_CLIENT_ID}&client_secret=${CONFIG.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    });

    if (!response.ok) {
      console.error('Erreur obtention token:', response.status);
      return null;
    }

    const data = await response.json();
    
    await chrome.storage.local.set({
      twitchToken: {
        access_token: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000)
      }
    });

    console.log('Token Twitch obtenu avec succès');
    return data.access_token;
  } catch (error) {
    console.error('Erreur obtention token Twitch:', error);
    return null;
  }
}

// Vérifier YouTube via Data API v3
async function checkYouTubeStatus(username) {
  try {
    // Rechercher la chaîne
    let channelId = username;
    
    // Si c'est un handle (@username), rechercher d'abord
    if (username.startsWith('@')) {
      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&key=${CONFIG.YOUTUBE_API_KEY}`
      );
      const searchData = await searchResponse.json();
      
      if (searchData.items && searchData.items[0]) {
        channelId = searchData.items[0].snippet.channelId;
      }
    }

    // Vérifier si en live
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${CONFIG.YOUTUBE_API_KEY}`
    );

    if (!response.ok) {
      throw new Error('Erreur API YouTube');
    }

    const data = await response.json();

    if (data.items && data.items.length > 0) {
      const video = data.items[0];
      
      // Récupérer les détails du live
      const detailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,snippet&id=${video.id.videoId}&key=${CONFIG.YOUTUBE_API_KEY}`
      );
      const detailsData = await detailsResponse.json();
      const details = detailsData.items[0];

      return {
        isLive: true,
        title: details.snippet.title,
        thumbnail: details.snippet.thumbnails.medium.url,
        viewerCount: parseInt(details.liveStreamingDetails.concurrentViewers || 0),
        startedAt: new Date(details.liveStreamingDetails.actualStartTime).getTime()
      };
    }

    return { isLive: false };
  } catch (error) {
    console.error('Erreur YouTube:', error);
    return { isLive: false, error: true };
  }
}

// Vérifier Kick (API non officielle)
async function checkKickStatus(username) {
  try {
    // Kick n'a pas d'API officielle, on scrape ou utilise des endpoints non documentés
    const response = await fetch(`https://kick.com/api/v2/channels/${username}`);
    
    if (!response.ok) {
      throw new Error('Erreur API Kick');
    }

    const data = await response.json();

    if (data.livestream) {
      return {
        isLive: true,
        title: data.livestream.session_title || 'Sans titre',
        thumbnail: data.livestream.thumbnail?.url || data.user?.profile_pic,
        viewerCount: data.livestream.viewer_count || 0,
        startedAt: new Date(data.livestream.created_at).getTime()
      };
    }

    return { isLive: false };
  } catch (error) {
    console.error('Erreur Kick:', error);
    return { isLive: false, error: true };
  }
}

// Obtenir les avatars des streamers
async function getStreamerAvatar(platform, username) {
  try {
    switch (platform) {
      case 'twitch':
        const token = await getTwitchToken();
        if (!token) return '';
        
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
          headers: {
            'Client-ID': CONFIG.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          return data.data[0]?.profile_image_url || '';
        }
        return '';
        
      case 'youtube':
        if (!CONFIG.YOUTUBE_API_KEY) return '';
        
        // Rechercher la chaîne
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&maxResults=1&key=${CONFIG.YOUTUBE_API_KEY}`;
        const ytResponse = await fetch(searchUrl);
        
        if (ytResponse.ok) {
          const ytData = await ytResponse.json();
          if (ytData.items && ytData.items[0]) {
            return ytData.items[0].snippet.thumbnails.default?.url || '';
          }
        }
        return '';
        
      case 'kick':
        const kickResponse = await fetch(`https://kick.com/api/v2/channels/${username}`);
        if (kickResponse.ok) {
          const kickData = await kickResponse.json();
          return kickData.user?.profile_pic || '';
        }
        return '';
        
      default:
        return '';
    }
  } catch (error) {
    console.error('Erreur récupération avatar:', error);
    return '';
  }
}

// Obtenir les données enrichies des streamers
async function getStreamersWithData() {
  const { streamers = [] } = await chrome.storage.sync.get('streamers');
  
  const enriched = await Promise.all(streamers.map(async (streamer) => {
    // Utiliser le cache si disponible et récent (moins de 30 secondes)
    const cached = streamersCache[streamer.id];
    if (cached && cached._cacheTime && (Date.now() - cached._cacheTime < 30000)) {
      return cached;
    }

    // Récupérer l'avatar si manquant
    if (!streamer.avatar) {
      streamer.avatar = await getStreamerAvatar(streamer.platform, streamer.username);
    }

    // Vérifier si était en live récemment
    if (streamer.lastLiveDate) {
      const timeSince = Date.now() - streamer.lastLiveDate;
      streamer.wasLiveRecently = timeSince < CONFIG.RECENT_LIVE_THRESHOLD;
    }

    // Marquer le cache
    streamer._cacheTime = Date.now();
    streamersCache[streamer.id] = streamer;

    return streamer;
  }));

  return enriched;
}

// Mettre à jour le badge et l'icône de l'extension
function updateBadgeAndIcon(hasLive, liveCount = 0) {
  if (hasLive) {
    // Badge avec nombre de lives
    chrome.action.setBadgeText({ text: liveCount > 0 ? liveCount.toString() : '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#5CFFE0' });
    
    // Icône verte (si vous avez des icônes colorées)
    chrome.action.setIcon({
      path: {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
      }
    });
  } else {
    // Pas de badge
    chrome.action.setBadgeText({ text: '' });
    
    // Icône normale
    chrome.action.setIcon({
      path: {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
      }
    });
  }
}

// Démarrage initial
loadApiKeys().then(() => {
  checkAllStreamers();
});
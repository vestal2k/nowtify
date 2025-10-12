// background.js - Service worker pour la logique de polling et notifications

// Configuration des API (chargées dynamiquement depuis le storage)
let CONFIG = {
  TWITCH_CLIENT_ID: '',
  TWITCH_CLIENT_SECRET: '',
  YOUTUBE_API_KEY: '',
  CHECK_INTERVAL: 5 * 60 * 1000, // 5 minutes
  RECENT_LIVE_THRESHOLD: 12 * 60 * 60 * 1000 // 12 heures
};

// État des streamers en cache
let streamersCache = {};
let checkInterval = null;
let isChecking = false;

// Installation de l'extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Nowtify installé !');
  
  // Charger les clés API
  await loadApiKeys();
  
  // Initialiser le stockage
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

  // Configurer l'alarme pour le polling
  chrome.alarms.create('checkStreams', { periodInMinutes: 5 });
  
  // Première vérification
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
    console.log('Clés API chargées', {
      hasTwitchId: !!CONFIG.TWITCH_CLIENT_ID,
      hasYoutubeKey: !!CONFIG.YOUTUBE_API_KEY
    });
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
    // Mettre à jour la configuration locale
    (async () => {
      if (request.apiKeys) {
        if (request.apiKeys.twitchClientId) {
          CONFIG.TWITCH_CLIENT_ID = request.apiKeys.twitchClientId;
        }
        if (request.apiKeys.twitchClientSecret) {
          CONFIG.TWITCH_CLIENT_SECRET = request.apiKeys.twitchClientSecret;
        }
        if (request.apiKeys.youtubeApiKey) {
          CONFIG.YOUTUBE_API_KEY = request.apiKeys.youtubeApiKey;
        }
        // Supprimer le token Twitch pour forcer le refresh
        await chrome.storage.local.remove('twitchToken');
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.action === 'updateAlarm') {
    // Mettre à jour l'alarme avec le nouvel intervalle
    chrome.alarms.clear('checkStreams', () => {
      chrome.alarms.create('checkStreams', { 
        periodInMinutes: request.minutes 
      });
    });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'searchStreamers') {
    // Recherche de streamers pour l'auto-complétion
    searchStreamers(request.query, request.platform).then(results => {
      sendResponse({ results });
    });
    return true;
  }
});

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
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
let teamLogosCache = {};
let isChecking = false;
let adaptiveTimers = {};
let lastCheck = {};

chrome.runtime.onInstalled.addListener(async () => {
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

chrome.runtime.onStartup.addListener(async () => {
  await loadApiKeys();
  checkAllStreamers();
});

async function loadApiKeys() {
  try {
    const { apiKeys = {} } = await chrome.storage.sync.get('apiKeys');
    CONFIG.TWITCH_CLIENT_ID = apiKeys.twitchClientId || '';
    CONFIG.TWITCH_CLIENT_SECRET = apiKeys.twitchClientSecret || '';
    CONFIG.YOUTUBE_API_KEY = apiKeys.youtubeApiKey || '';
  } catch (error) {}
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkStreams') {
    checkAllStreamers();
  }
});
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
    }).catch(() => {
      sendResponse({ results: [] });
    });
    return true;
  }

  if (request.action === 'searchTeams') {
    searchTwitchTeams(request.query).then(results => {
      sendResponse({ results });
    }).catch(() => {
      sendResponse({ results: [] });
    });
    return true;
  }

  if (request.action === 'addTwitchTeam') {
    addTwitchTeam(request.teamName).then(result => {
      sendResponse(result);
    }).catch(error => {
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
        updatedStreamers.push(streamer);
      }
    }

    updateBadgeAndIcon(liveCount > 0, liveCount);
    await chrome.storage.sync.set({ streamers: updatedStreamers });

  } catch (error) {
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
      return null;
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${CONFIG.TWITCH_CLIENT_ID}&client_secret=${CONFIG.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    });

    if (!response.ok) {
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
    return [];
  }
}

async function getTeamLogo(teamName) {
  if (!teamName) return null;

  const cacheKey = teamName.toLowerCase();
  if (teamLogosCache[cacheKey]) {
    return teamLogosCache[cacheKey];
  }

  try {
    const token = await getTwitchToken();
    if (!token) return null;

    const response = await fetch(`https://api.twitch.tv/helix/teams?name=${teamName}`, {
      headers: {
        'Client-ID': CONFIG.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.data && data.data[0]) {
        const logoUrl = data.data[0].thumbnail_url || data.data[0].banner || null;
        teamLogosCache[cacheKey] = logoUrl;
        
        if (logoUrl) {
          await chrome.storage.local.set({ [`teamLogo_${cacheKey}`]: logoUrl });
        }
        
        return logoUrl;
      }
    }
  } catch (error) {}

  return null;
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

    if (streamer.team && !streamer.teamLogo) {
      const cachedLogo = await chrome.storage.local.get(`teamLogo_${streamer.team.toLowerCase()}`);
      if (cachedLogo[`teamLogo_${streamer.team.toLowerCase()}`]) {
        streamer.teamLogo = cachedLogo[`teamLogo_${streamer.team.toLowerCase()}`];
      } else {
        streamer.teamLogo = await getTeamLogo(streamer.team);
      }
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

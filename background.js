const CONFIG = {
  TWITCH_CLIENT_ID: 'c045ge8cvqpo91s6og7bo8eygb7upi',
  YOUTUBE_API_KEY: 'AIzaSyA6jyZjzCFcglEUWl_EBME88svlWGiQfWQ',
  CHECK_INTERVAL: 5 * 60 * 1000,
  RECENT_LIVE_THRESHOLD: 12 * 60 * 60 * 1000
};

let streamersCache = {};
let checkInterval = null;
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Nowtify installé !');
  
  const { streamers } = await chrome.storage.sync.get('streamers');
  if (!streamers) {
    await chrome.storage.sync.set({ 
      streamers: [],
      settings: {
        notifications: true,
        autoRefresh: true,
        theme: 'dark'
      }
    });
  }

  chrome.alarms.create('checkStreams', { periodInMinutes: 5 });
  
  checkAllStreamers();
});

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
      if (request.apiKeys.twitchClientId) {
        CONFIG.TWITCH_CLIENT_ID = request.apiKeys.twitchClientId;
      }
      if (request.apiKeys.youtubeApiKey) {
        CONFIG.YOUTUBE_API_KEY = request.apiKeys.youtubeApiKey;
      }
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
});

async function checkAllStreamers() {
  try {
    const { streamers = [], settings = {} } = await chrome.storage.sync.get(['streamers', 'settings']);
    
    if (streamers.length === 0) {
      updateBadge(false);
      return;
    }

    const updatedStreamers = [];
    let hasLiveStreamer = false;

    for (const streamer of streamers) {
      const data = await checkStreamerStatus(streamer);
      const updated = { ...streamer, ...data };
      
      if (data.isLive && !streamer.isLive && settings.notifications !== false) {
        sendNotification(updated);
      }
      
      if (data.isLive) {
        hasLiveStreamer = true;
      }
      
      updatedStreamers.push(updated);
      streamersCache[streamer.id] = updated;
    }

    updateBadge(hasLiveStreamer);

    await chrome.storage.sync.set({ streamers: updatedStreamers });

  } catch (error) {
    console.error('Erreur lors de la vérification:', error);
  }
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
    const token = await getTwitchToken();
    
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
      headers: {
        'Client-ID': CONFIG.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
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
        startedAt: new Date(stream.started_at).getTime()
      };
    }

    return { isLive: false };
  } catch (error) {
    console.error('Erreur Twitch:', error);
    return { isLive: false, error: true };
  }
}

async function getTwitchToken() {
  const { twitchToken } = await chrome.storage.local.get('twitchToken');
  
  if (twitchToken && twitchToken.expiresAt > Date.now()) {
    return twitchToken.access_token;
  }

  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${CONFIG.TWITCH_CLIENT_ID}&client_secret=VOTRE_CLIENT_SECRET&grant_type=client_credentials`
    });

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
    let channelId = username;
    
    if (username.startsWith('@')) {
      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&key=${CONFIG.YOUTUBE_API_KEY}`
      );
      const searchData = await searchResponse.json();
      
      if (searchData.items && searchData.items[0]) {
        channelId = searchData.items[0].snippet.channelId;
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
        startedAt: new Date(details.liveStreamingDetails.actualStartTime).getTime()
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

async function getStreamerAvatar(streamer) {
  try {
    switch (streamer.platform) {
      case 'twitch':
        const token = await getTwitchToken();
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${streamer.username}`, {
          headers: {
            'Client-ID': CONFIG.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await response.json();
        return data.data[0]?.profile_image_url || '';
        
      case 'youtube':
        return streamer.avatar || '';
        
      case 'kick':
        const kickResponse = await fetch(`https://kick.com/api/v2/channels/${streamer.username}`);
        const kickData = await kickResponse.json();
        return kickData.user?.profile_pic || '';
        
      default:
        return '';
    }
  } catch (error) {
    return '';
  }
}

async function getStreamersWithData() {
  const { streamers = [] } = await chrome.storage.sync.get('streamers');
  
  const enriched = await Promise.all(streamers.map(async (streamer) => {
    if (streamersCache[streamer.id]) {
      return streamersCache[streamer.id];
    }

    if (!streamer.avatar) {
      streamer.avatar = await getStreamerAvatar(streamer);
    }

    if (streamer.lastLiveDate) {
      const timeSince = Date.now() - streamer.lastLiveDate;
      streamer.wasLiveRecently = timeSince < CONFIG.RECENT_LIVE_THRESHOLD;
    }

    return streamer;
  }));

  return enriched;
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

  chrome.notifications.onClicked.addListener((clickedId) => {
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
    }
  });

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

function updateBadge(hasLive) {
  if (hasLive) {
    chrome.action.setBadgeText({ text: '🔴' });
    chrome.action.setBadgeBackgroundColor({ color: '#5CFFE0' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

checkAllStreamers();
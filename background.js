let CONFIG = {
  TWITCH_CLIENT_ID: '',
  TWITCH_CLIENT_SECRET: '',
  YOUTUBE_API_KEY: '',
  CHECK_INTERVAL_FAST: 30 * 1000,
  CHECK_INTERVAL_NORMAL: 3 * 60 * 1000,
  CHECK_INTERVAL_SLOW: 5 * 60 * 1000,
  RECENT_LIVE_THRESHOLD: 12 * 60 * 60 * 1000,
  AUTO_REFRESH_INTERVAL: 5 * 60 * 1000
};

let streamersCache = {};
let teamLogosCache = {};
let isChecking = false;
let adaptiveTimers = {};
let lastCheck = {};

// IndexedDB for large data storage
const DB_NAME = 'NowtifyDB';
const DB_VERSION = 1;
let dbInstance = null;

async function openDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store for streamers list
      if (!db.objectStoreNames.contains('streamers')) {
        db.createObjectStore('streamers', { keyPath: 'id' });
      }

      // Store for history
      if (!db.objectStoreNames.contains('history')) {
        const historyStore = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Store for groups
      if (!db.objectStoreNames.contains('groups')) {
        db.createObjectStore('groups', { keyPath: 'id' });
      }
    };
  });
}

// Get all streamers from IndexedDB
async function getStreamersFromDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['streamers'], 'readonly');
      const store = transaction.objectStore('streamers');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('IndexedDB read failed, falling back to chrome.storage:', error);
    const { streamers = [] } = await chrome.storage.sync.get('streamers');
    return streamers;
  }
}

// Save all streamers to IndexedDB and sync to chrome.storage
async function saveStreamersToDB(streamers, skipSync = false) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['streamers'], 'readwrite');
      const store = transaction.objectStore('streamers');

      // Clear existing and add all
      store.clear();
      for (const streamer of streamers) {
        store.put(streamer);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    // Sync to chrome.storage.sync for popup/options compatibility
    if (!skipSync) {
      try {
        await chrome.storage.sync.set({ streamers });
      } catch (syncError) {
        // chrome.storage.sync has size limits, ignore if too large
        console.warn('Could not sync to chrome.storage.sync:', syncError);
      }
    }
  } catch (error) {
    console.warn('IndexedDB write failed, falling back to chrome.storage:', error);
    await chrome.storage.sync.set({ streamers });
  }
}

// Migrate data from chrome.storage.sync to IndexedDB
async function migrateToIndexedDB() {
  try {
    const db = await openDB();
    const existingStreamers = await getStreamersFromDB();

    // Only migrate if IndexedDB is empty
    if (existingStreamers.length === 0) {
      const { streamers = [] } = await chrome.storage.sync.get('streamers');
      if (streamers.length > 0) {
        await saveStreamersToDB(streamers);
        console.log(`Migrated ${streamers.length} streamers to IndexedDB`);
      }
    }

    // Migrate history
    const { history = [] } = await chrome.storage.local.get('history');
    if (history.length > 0) {
      const transaction = db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');

      const countRequest = store.count();
      countRequest.onsuccess = async () => {
        if (countRequest.result === 0) {
          for (const entry of history) {
            store.put({ ...entry, id: entry.id || Date.now() + Math.random() });
          }
        }
      };
    }

    // Migrate groups
    const { groups = [] } = await chrome.storage.sync.get('groups');
    if (groups.length > 0) {
      const transaction = db.transaction(['groups'], 'readwrite');
      const store = transaction.objectStore('groups');

      const countRequest = store.count();
      countRequest.onsuccess = async () => {
        if (countRequest.result === 0) {
          for (const group of groups) {
            store.put(group);
          }
        }
      };
    }
  } catch (error) {
    console.warn('Migration to IndexedDB failed:', error);
  }
}

// Get history from IndexedDB
async function getHistoryFromDB(limit = 50) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['history'], 'readonly');
      const store = transaction.objectStore('history');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');

      const results = [];
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    const { history = [] } = await chrome.storage.local.get('history');
    return history.slice(0, limit);
  }
}

// Save history entry to IndexedDB
async function saveHistoryToDB(entry) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');

      entry.id = entry.id || Date.now() + Math.random();
      store.put(entry);

      // Clean up old entries (keep last 100)
      const index = store.index('timestamp');
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        if (countRequest.result > 100) {
          const deleteRequest = index.openCursor();
          let deleted = 0;
          const toDelete = countRequest.result - 100;

          deleteRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && deleted < toDelete) {
              cursor.delete();
              deleted++;
              cursor.continue();
            }
          };
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    // Fallback to chrome.storage.local
    const { history = [] } = await chrome.storage.local.get('history');
    history.unshift(entry);
    await chrome.storage.local.set({ history: history.slice(0, 50) });
  }
}

// Get groups from IndexedDB
async function getGroupsFromDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['groups'], 'readonly');
      const store = transaction.objectStore('groups');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    const { groups = [] } = await chrome.storage.sync.get('groups');
    return groups;
  }
}

// Save groups to IndexedDB
async function saveGroupsToDB(groups) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['groups'], 'readwrite');
      const store = transaction.objectStore('groups');

      store.clear();
      for (const group of groups) {
        store.put(group);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    await chrome.storage.sync.set({ groups });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setIcon({
    path: {
      16: 'icons/logo.png',
      32: 'icons/logo.png',
      48: 'icons/logo.png',
      128: 'icons/logo.png'
    }
  });

  await loadApiKeys();

  // Initialize IndexedDB and migrate existing data
  await migrateToIndexedDB();

  // Initialize settings in chrome.storage.sync (small data)
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings) {
    await chrome.storage.sync.set({
      settings: {
        notifications: true,
        autoRefresh: true,
        theme: 'dark',
        refreshInterval: '5'
      }
    });
  }

  chrome.alarms.create('checkStreams', { periodInMinutes: 5 });
  setTimeout(() => checkAllStreamers(), 2000);
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.action.setIcon({
    path: {
      16: 'icons/logo.png',
      32: 'icons/logo.png',
      48: 'icons/logo.png',
      128: 'icons/logo.png'
    }
  });

  await loadApiKeys();
  await migrateToIndexedDB();
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

  // IndexedDB CRUD operations for popup/options
  if (request.action === 'getStreamers') {
    getStreamersFromDB().then(streamers => sendResponse({ streamers }));
    return true;
  }

  if (request.action === 'saveStreamers') {
    saveStreamersToDB(request.streamers).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'getGroups') {
    getGroupsFromDB().then(groups => sendResponse({ groups }));
    return true;
  }

  if (request.action === 'saveGroups') {
    saveGroupsToDB(request.groups).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'getHistory') {
    getHistoryFromDB(request.limit || 50).then(history => sendResponse({ history }));
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

    const streamers = await getStreamersFromDB();
    let addedCount = 0;

    for (const user of teamUsers) {
      const existingIndex = streamers.findIndex(s =>
        s.platform === 'twitch' && s.username.toLowerCase() === user.user_login.toLowerCase()
      );

      if (existingIndex >= 0) {
        streamers[existingIndex].team = teamName;
      } else {
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

    await saveStreamersToDB(streamers);
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

    // Use IndexedDB for streamers, chrome.storage.sync for settings
    const streamers = await getStreamersFromDB();
    const { settings = {} } = await chrome.storage.sync.get('settings');

    if (streamers.length === 0) {
      updateBadge(0);
      isChecking = false;
      return;
    }

    // Group streamers by platform for batch requests
    const byPlatform = {
      twitch: streamers.filter(s => s.platform === 'twitch'),
      youtube: streamers.filter(s => s.platform === 'youtube'),
      kick: streamers.filter(s => s.platform === 'kick')
    };

    // Batch fetch status for each platform
    const statusMap = new Map();

    // Batch Twitch requests (supports up to 100 users per request)
    if (byPlatform.twitch.length > 0) {
      const twitchStatuses = await checkTwitchStatusBatch(byPlatform.twitch.map(s => s.username));
      for (const [username, status] of Object.entries(twitchStatuses)) {
        statusMap.set(`twitch_${username.toLowerCase()}`, status);
      }
    }

    // YouTube and Kick don't support batch, but we can parallelize
    const [youtubeResults, kickResults] = await Promise.all([
      Promise.all(byPlatform.youtube.map(async s => {
        const status = await checkYouTubeStatus(s.username);
        return { username: s.username, status };
      })),
      Promise.all(byPlatform.kick.map(async s => {
        const status = await checkKickStatus(s.username);
        return { username: s.username, status };
      }))
    ]);

    for (const { username, status } of youtubeResults) {
      statusMap.set(`youtube_${username.toLowerCase()}`, status);
    }
    for (const { username, status } of kickResults) {
      statusMap.set(`kick_${username.toLowerCase()}`, status);
    }

    const updatedStreamers = [];
    let liveCount = 0;

    for (const streamer of streamers) {
      try {
        const statusKey = `${streamer.platform}_${streamer.username.toLowerCase()}`;
        const data = statusMap.get(statusKey) || { isLive: false };

        if (!data.avatar || data.avatar === '') {
          data.avatar = await getStreamerAvatar(streamer.platform, streamer.username);
        }

        const updated = { ...streamer, ...data };

        if (streamer.platform === 'twitch' && !updated.team) {
          const teamName = await getStreamerTeam(streamer.username);
          if (teamName) {
            updated.team = teamName;
          }
        }

        if (data.isLive) {
          updated.lastLiveDate = Date.now();
          updated.endedAt = null;
        } else if (!data.isLive && streamer.isLive) {
          updated.lastLiveDate = streamer.lastLiveDate || Date.now();
          updated.endedAt = Date.now();
        } else if (updated.lastLiveDate) {
          const timeSince = Date.now() - updated.lastLiveDate;
          updated.wasLiveRecently = timeSince < CONFIG.RECENT_LIVE_THRESHOLD;
        }

        if (data.isLive && !streamer.isLive && settings.notifications !== false) {
          sendNotification(updated);
        }

        if (data.isLive) {
          liveCount++;
          updated.priority = 'high';
          scheduleAdaptiveCheck(updated.id, CONFIG.CHECK_INTERVAL_FAST);
        } else if (updated.wasLiveRecently) {
          updated.priority = 'medium';
          scheduleAdaptiveCheck(updated.id, CONFIG.CHECK_INTERVAL_NORMAL);
        } else {
          updated.priority = 'normal';
          scheduleAdaptiveCheck(updated.id, CONFIG.CHECK_INTERVAL_SLOW);
        }

        lastCheck[streamer.id] = Date.now();

        const streamersData = { ...updated };
        delete streamersData.avatar;
        delete streamersData.thumbnail;
        delete streamersData.teamLogo;

        updatedStreamers.push(streamersData);

        if (updated.avatar) {
          await chrome.storage.local.set({ [`avatar_${updated.id}`]: updated.avatar });
        }

        // Cache thumbnail in storage for persistence
        if (updated.thumbnail) {
          await chrome.storage.local.set({ [`thumbnail_${updated.id}`]: updated.thumbnail });
        }

        streamersCache[streamer.id] = updated;
      } catch (error) {
        updatedStreamers.push(streamer);
      }
    }

    updateBadge(liveCount);
    await saveStreamersToDB(updatedStreamers);

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
    const streamers = await getStreamersFromDB();
    const { settings = {} } = await chrome.storage.sync.get('settings');
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
          await saveStreamersToDB(streamers);
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

// Batch check Twitch status for multiple users (up to 100 per request)
async function checkTwitchStatusBatch(usernames) {
  const results = {};

  if (!CONFIG.TWITCH_CLIENT_ID || usernames.length === 0) {
    usernames.forEach(u => results[u.toLowerCase()] = { isLive: false, error: true });
    return results;
  }

  try {
    const token = await getTwitchToken();
    if (!token) {
      usernames.forEach(u => results[u.toLowerCase()] = { isLive: false, error: true });
      return results;
    }

    // Twitch API supports up to 100 user_login parameters per request
    const chunks = [];
    for (let i = 0; i < usernames.length; i += 100) {
      chunks.push(usernames.slice(i, i + 100));
    }

    for (const chunk of chunks) {
      const params = chunk.map(u => `user_login=${encodeURIComponent(u)}`).join('&');
      const response = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
        headers: {
          'Client-ID': CONFIG.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          await chrome.storage.local.remove('twitchToken');
        }
        chunk.forEach(u => results[u.toLowerCase()] = { isLive: false, error: true });
        continue;
      }

      const data = await response.json();

      // Map live streams by username
      const liveStreams = new Map();
      for (const stream of data.data) {
        liveStreams.set(stream.user_login.toLowerCase(), {
          isLive: true,
          title: stream.title,
          game: stream.game_name,
          viewerCount: stream.viewer_count,
          thumbnail: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
          startedAt: new Date(stream.started_at).getTime(),
          lastLiveDate: Date.now(),
          endedAt: null
        });
      }

      // Fill results for this chunk
      for (const username of chunk) {
        const lowerUsername = username.toLowerCase();
        if (liveStreams.has(lowerUsername)) {
          results[lowerUsername] = liveStreams.get(lowerUsername);
        } else {
          results[lowerUsername] = { isLive: false, endedAt: Date.now() };
        }
      }
    }
  } catch (error) {
    usernames.forEach(u => results[u.toLowerCase()] = { isLive: false, error: true });
  }

  return results;
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
        lastLiveDate: Date.now(),
        endedAt: null
      };
    }

    return { 
      isLive: false,
      endedAt: Date.now()
    };
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
        lastLiveDate: Date.now(),
        endedAt: null
      };
    }

    return { 
      isLive: false,
      endedAt: Date.now()
    };
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
      const avatarUrl = data.user?.profile_pic || data.user?.avatar || data.livestream.thumbnail?.url || '';
      return {
        isLive: true,
        title: data.livestream.session_title || 'Sans titre',
        thumbnail: data.livestream.thumbnail?.url || avatarUrl,
        viewerCount: data.livestream.viewer_count || 0,
        startedAt: new Date(data.livestream.created_at).getTime(),
        lastLiveDate: Date.now(),
        endedAt: null,
        avatar: avatarUrl
      };
    }

    return { 
      isLive: false,
      endedAt: Date.now()
    };
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
          const avatarUrl = data.data[0]?.profile_image_url || '';
          return avatarUrl;
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
          const avatarUrl = kickData.user?.profile_pic || kickData.user?.avatar || kickData.profile_pic || '';
          if (avatarUrl && !avatarUrl.includes('placeholder') && !avatarUrl.includes('default')) {
            return avatarUrl;
          }
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
    const results = [];
    
    const twitchResults = await searchTwitchStreamers(query);
    results.push(...twitchResults);
    
    if (CONFIG.YOUTUBE_API_KEY) {
      const youtubeResults = await searchYouTubeChannels(query);
      results.push(...youtubeResults);
    }
    
    const kickResults = await searchKickChannels(query);
    results.push(...kickResults);
    
    return results;
  } catch (error) {
    return [];
  }
}

async function searchTwitchStreamers(query) {
  try {
    const token = await getTwitchToken();
    if (!token) return [];

    const response = await fetch(
      `https://api.twitch.tv/helix/search/channels?query=${encodeURIComponent(query)}&first=10`,
      {
        headers: {
          'Client-ID': CONFIG.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.data
        .sort((a, b) => {
          if (a.is_live !== b.is_live) return b.is_live - a.is_live;
          if (a.broadcaster_type !== b.broadcaster_type) {
            const priority = { partner: 3, affiliate: 2, '': 1 };
            return (priority[b.broadcaster_type] || 0) - (priority[a.broadcaster_type] || 0);
          }
          return 0;
        })
        .slice(0, 5)
        .map(channel => ({
          name: channel.display_name,
          username: channel.broadcaster_login,
          avatar: channel.thumbnail_url,
          platform: 'twitch',
          isLive: channel.is_live,
          isPartner: channel.broadcaster_type === 'partner'
        }));
    }
    
    return [];
  } catch (error) {
    return [];
  }
}

async function searchYouTubeChannels(query) {
  try {
    if (!CONFIG.YOUTUBE_API_KEY) return [];

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=3&key=${CONFIG.YOUTUBE_API_KEY}`
    );

    if (response.ok) {
      const data = await response.json();
      return data.items.map(item => ({
        name: item.snippet.title,
        username: item.snippet.channelId,
        avatar: item.snippet.thumbnails.default?.url || '',
        platform: 'youtube',
        isLive: false
      }));
    }
    
    return [];
  } catch (error) {
    return [];
  }
}

async function searchKickChannels(query) {
  try {
    const response = await fetch(`https://kick.com/api/search?searched_word=${encodeURIComponent(query)}`);
    
    if (response.ok) {
      const data = await response.json();
      const channels = data.channels || [];
      return channels.slice(0, 3).map(channel => {
        const avatarUrl = channel.user?.profile_pic || channel.user?.avatar || channel.profile_pic || '';
        return {
          name: channel.username,
          username: channel.slug || channel.username,
          avatar: avatarUrl && !avatarUrl.includes('placeholder') ? avatarUrl : '',
          platform: 'kick',
          isLive: channel.is_live || false
        };
      });
    }
    
    return [];
  } catch (error) {
    return [];
  }
}

// Generate possible team name variants for API lookup
function getTeamNameVariants(teamName) {
  const base = teamName.toLowerCase().trim();
  const variants = new Set([base]);

  // Without spaces
  variants.add(base.replace(/\s+/g, ''));

  // With underscores instead of spaces
  variants.add(base.replace(/\s+/g, '_'));

  // With hyphens instead of spaces
  variants.add(base.replace(/\s+/g, '-'));

  // Without special characters
  variants.add(base.replace(/[^a-z0-9]/g, ''));

  // Common team name patterns (e.g., "Team Name" -> "teamname")
  variants.add(base.replace(/^team\s*/i, '').replace(/\s+/g, ''));

  return [...variants].filter(v => v.length > 0);
}

async function getTeamLogo(teamName) {
  if (!teamName) return null;

  const cacheKey = teamName.toLowerCase().trim();

  // Check memory cache first
  if (teamLogosCache[cacheKey]) {
    return teamLogosCache[cacheKey];
  }

  try {
    const token = await getTwitchToken();
    if (!token) {
      console.warn('[Nowtify] No Twitch token available for team logo fetch');
      return null;
    }

    // Try different name variants
    const variants = getTeamNameVariants(teamName);

    for (const variant of variants) {
      try {
        const response = await fetch(`https://api.twitch.tv/helix/teams?name=${encodeURIComponent(variant)}`, {
          headers: {
            'Client-ID': CONFIG.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data[0]) {
            // Twitch Teams API returns thumbnail_url as the logo
            let logoUrl = data.data[0].thumbnail_url || null;

            // Some teams may have empty thumbnail, try background_image_url as fallback
            if (!logoUrl && data.data[0].background_image_url) {
              logoUrl = data.data[0].background_image_url;
            }

            if (logoUrl) {
              // Cache the result
              teamLogosCache[cacheKey] = logoUrl;
              await chrome.storage.local.set({ [`teamLogo_${cacheKey}`]: logoUrl });
              console.log(`[Nowtify] Team logo found for "${teamName}" using variant "${variant}"`);
              return logoUrl;
            }
          }
        } else if (response.status === 404) {
          // Team not found with this variant, try next
          continue;
        } else if (response.status === 401 || response.status === 403) {
          // Token issue, don't try more variants
          console.warn(`[Nowtify] Auth error fetching team logo: ${response.status}`);
          break;
        }
      } catch (fetchError) {
        // Network error for this variant, try next
        console.warn(`[Nowtify] Network error fetching team "${variant}": ${fetchError.message}`);
        continue;
      }
    }

    // No logo found with any variant - cache null to avoid repeated lookups
    teamLogosCache[cacheKey] = null;
    console.log(`[Nowtify] No team logo found for "${teamName}" after trying ${variants.length} variants`);

  } catch (error) {
    console.error(`[Nowtify] Error fetching team logo for "${teamName}":`, error);
  }

  return null;
}

async function getStreamerTeam(username) {
  try {
    const token = await getTwitchToken();
    if (!token) return null;

    const userResponse = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
      headers: {
        'Client-ID': CONFIG.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!userResponse.ok) return null;

    const userData = await userResponse.json();
    if (!userData.data || userData.data.length === 0) return null;

    const userId = userData.data[0].id;

    const teamsResponse = await fetch(`https://api.twitch.tv/helix/teams/channel?broadcaster_id=${userId}`, {
      headers: {
        'Client-ID': CONFIG.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!teamsResponse.ok) return null;

    const teamsData = await teamsResponse.json();
    if (teamsData.data && teamsData.data.length > 0) {
      return teamsData.data[0].team_name;
    }

    return null;
  } catch (error) {
    return null;
  }
}

async function getStreamersWithData() {
  const streamers = await getStreamersFromDB();

  const enriched = await Promise.all(streamers.map(async (streamer) => {
    const cached = streamersCache[streamer.id];
    if (cached && cached._cacheTime && (Date.now() - cached._cacheTime < 30000)) {
      return cached;
    }

    const avatarCache = await chrome.storage.local.get(`avatar_${streamer.id}`);
    if (avatarCache[`avatar_${streamer.id}`]) {
      streamer.avatar = avatarCache[`avatar_${streamer.id}`];
    } else if (!streamer.avatar) {
      streamer.avatar = await getStreamerAvatar(streamer.platform, streamer.username);
      if (streamer.avatar) {
        await chrome.storage.local.set({ [`avatar_${streamer.id}`]: streamer.avatar });
      }
    }

    if (streamer.platform === 'twitch' && !streamer.team) {
      const teamName = await getStreamerTeam(streamer.username);
      if (teamName) {
        streamer.team = teamName;
      }
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

    // Include thumbnail and game from cache if available
    const cachedData = streamersCache[streamer.id];
    if (cachedData) {
      if (cachedData.thumbnail) streamer.thumbnail = cachedData.thumbnail;
      if (cachedData.game) streamer.game = cachedData.game;
    }

    // Try to load thumbnail from persistent storage if not in memory cache
    if (!streamer.thumbnail) {
      const thumbnailCache = await chrome.storage.local.get(`thumbnail_${streamer.id}`);
      if (thumbnailCache[`thumbnail_${streamer.id}`]) {
        streamer.thumbnail = thumbnailCache[`thumbnail_${streamer.id}`];
      }
    }

    streamer._cacheTime = Date.now();
    streamersCache[streamer.id] = streamer;

    return streamer;
  }));

  return enriched;
}

async function updateBadge(liveCount) {
  if (liveCount > 0) {
    // Show count in native Chrome badge with Nowtify colors
    const badgeText = liveCount > 99 ? '99+' : liveCount.toString();
    chrome.action.setBadgeText({ text: badgeText });
    // Use cyan color from Nowtify palette for better brand consistency
    chrome.action.setBadgeBackgroundColor({ color: '#5CFFE0' });
    chrome.action.setBadgeTextColor({ color: '#161618' });
  } else {
    // Clear badge when no one is live
    chrome.action.setBadgeText({ text: '' });
  }
}

const notificationHandlers = new Map();

async function sendNotification(streamer) {
  const notificationId = `live-${streamer.id}-${Date.now()}`;

  // Store streamer URL for click handler
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
    notificationHandlers.set(notificationId, url);
  }

  // Use logo.png as fallback (icon128.png doesn't exist)
  const iconUrl = streamer.avatar && streamer.avatar.startsWith('http')
    ? streamer.avatar
    : 'icons/logo.png';

  // Get settings for sound
  const { settings = {} } = await chrome.storage.sync.get('settings');

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: iconUrl,
    title: `${streamer.name} est en live !`,
    message: streamer.title || `${streamer.name} vient de commencer un stream sur ${streamer.platform}`,
    priority: 2,
    requireInteraction: settings.persistentNotifications === true,
    silent: !settings.notificationSound
  }, (createdId) => {
    if (chrome.runtime.lastError) {
      console.error('Notification error:', chrome.runtime.lastError.message);
    }
  });

  // Play custom sound if enabled
  if (settings.notificationSound) {
    playNotificationSound(settings.notificationSoundType || 'default');
  }

  saveToHistory(streamer);
}

// Sound generation using offscreen document or simple audio
async function playNotificationSound(soundType) {
  try {
    // For service workers, we need to use chrome.offscreen or a simple approach
    // Since offscreen API may not be available, we'll skip for now in background
    // The sound will be played when notification is shown (native browser sound)
    // or through the popup/options page preview
  } catch (error) {
    console.warn('Could not play notification sound:', error);
  }
}

// Single global click handler for all notifications
chrome.notifications.onClicked.addListener((notificationId) => {
  const url = notificationHandlers.get(notificationId);
  if (url) {
    chrome.tabs.create({ url });
    notificationHandlers.delete(notificationId);
  }
  chrome.notifications.clear(notificationId);
});

// Clean up closed notifications
chrome.notifications.onClosed.addListener((notificationId) => {
  notificationHandlers.delete(notificationId);
});

async function saveToHistory(streamer) {
  // Calculate duration if we have startedAt
  let duration = null;
  if (streamer.startedAt) {
    duration = Date.now() - streamer.startedAt;
  }

  const entry = {
    streamerId: streamer.id,
    name: streamer.name,
    platform: streamer.platform,
    title: streamer.title,
    game: streamer.game || null,
    duration: duration,
    viewerCount: streamer.viewerCount || null,
    timestamp: Date.now()
  };

  await saveHistoryToDB(entry);
}

// Sync chrome.storage.sync changes to IndexedDB (for popup/options changes)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    // Use skipSync=true to avoid infinite loop
    if (changes.streamers?.newValue) {
      saveStreamersToDB(changes.streamers.newValue, true).catch(() => {});
    }
    if (changes.groups?.newValue) {
      saveGroupsToDB(changes.groups.newValue, true).catch(() => {});
    }
  }
});

loadApiKeys().then(() => {
  migrateToIndexedDB().then(() => {
    checkAllStreamers();
  });
});

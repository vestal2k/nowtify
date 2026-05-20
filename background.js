const TWITCH_CLIENT_ID = 'bel47qfvj0ib2a4tclxon7f263uf4o';

const CONFIG = {
  RECENT_LIVE_THRESHOLD: 12 * 60 * 60 * 1000,
  NOTIFICATION_COOLDOWN: 30 * 60 * 1000
};

let streamersCache = {};
let teamLogosCache = {};
let isChecking = false;
let checkStartedAt = 0;
const CHECK_TIMEOUT = 2 * 60 * 1000;
let cachedToken = null;
let tokenValidatedAt = 0;
const TOKEN_REVALIDATE_INTERVAL = 30 * 60 * 1000;

async function setAuthErrorFlag(hasError) {
  try {
    await chrome.storage.session.set({ lastCheckHadAuthError: hasError });
  } catch {}
}

async function getAuthErrorFlag() {
  try {
    const { lastCheckHadAuthError = false } = await chrome.storage.session.get('lastCheckHadAuthError');
    return lastCheckHadAuthError;
  } catch {
    return false;
  }
}

async function getNotifiedStreamers() {
  try {
    const { notifiedStreamers = {} } = await chrome.storage.local.get('notifiedStreamers');
    return notifiedStreamers;
  } catch {
    return {};
  }
}

async function setStreamerNotified(streamerId) {
  try {
    const notified = await getNotifiedStreamers();
    notified[streamerId] = Date.now();

    const cutoff = Date.now() - CONFIG.NOTIFICATION_COOLDOWN;
    for (const [id, timestamp] of Object.entries(notified)) {
      if (timestamp < cutoff) {
        delete notified[id];
      }
    }

    await chrome.storage.local.set({ notifiedStreamers: notified });
  } catch {}
}

async function wasRecentlyNotified(streamerId) {
  try {
    const notified = await getNotifiedStreamers();
    const lastNotified = notified[streamerId];
    if (!lastNotified) return false;
    return (Date.now() - lastNotified) < CONFIG.NOTIFICATION_COOLDOWN;
  } catch {
    return false;
  }
}

async function clearStreamerNotified(streamerId) {
  try {
    const notified = await getNotifiedStreamers();
    delete notified[streamerId];
    await chrome.storage.local.set({ notifiedStreamers: notified });
  } catch {}
}

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

      if (!db.objectStoreNames.contains('streamers')) {
        db.createObjectStore('streamers', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('history')) {
        const historyStore = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      if (!db.objectStoreNames.contains('groups')) {
        db.createObjectStore('groups', { keyPath: 'id' });
      }
    };
  });
}

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

async function saveStreamersToDB(streamers, skipSync = false) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['streamers'], 'readwrite');
      const store = transaction.objectStore('streamers');

      store.clear();
      for (const streamer of streamers) {
        store.put(streamer);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    if (!skipSync) {
      try {
        await chrome.storage.sync.set({ streamers });
      } catch (syncError) {
        console.warn('Could not sync to chrome.storage.sync:', syncError);
      }
    }
  } catch (error) {
    console.warn('IndexedDB write failed, falling back to chrome.storage:', error);
    await chrome.storage.sync.set({ streamers });
  }
}

async function migrateToIndexedDB() {
  try {
    const db = await openDB();
    const existingStreamers = await getStreamersFromDB();

    if (existingStreamers.length === 0) {
      const { streamers = [] } = await chrome.storage.sync.get('streamers');
      if (streamers.length > 0) {
        await saveStreamersToDB(streamers);
      }
    }

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

async function saveHistoryToDB(entry) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');

      entry.id = entry.id || Date.now() + Math.random();
      store.put(entry);

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
    const { history = [] } = await chrome.storage.local.get('history');
    history.unshift(entry);
    await chrome.storage.local.set({ history: history.slice(0, 50) });
  }
}

async function clearHistoryFromDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');
      store.clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    await chrome.storage.local.set({ history: [] });
  }
}

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

function applyDefaultIcon() {
  chrome.action.setIcon({
    path: {
      16: 'icons/logo.png',
      32: 'icons/logo.png',
      48: 'icons/logo.png',
      128: 'icons/logo.png'
    }
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  applyDefaultIcon();

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
});

chrome.runtime.onStartup.addListener(() => {
  applyDefaultIcon();
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
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'twitchLogin') {
    loginWithTwitch().then(result => sendResponse(result));
    return true;
  }

  if (request.action === 'twitchLogout') {
    logoutTwitch().then(result => sendResponse(result));
    return true;
  }

  if (request.action === 'getTwitchAuthStatus') {
    getTwitchAuthStatus().then(status => sendResponse(status));
    return true;
  }

  if (request.action === 'updateAlarm') {
    chrome.alarms.clear('checkStreams', () => {
      chrome.alarms.create('checkStreams', {
        periodInMinutes: request.minutes
      });
      sendResponse({ success: true });
    });
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

  if (request.action === 'clearHistory') {
    clearHistoryFromDB().then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
    return true;
  }

  if (request.action === 'getAuthError') {
    getAuthErrorFlag().then(hasAuthError => sendResponse({ hasAuthError }));
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

const KNOWN_TEAMS = [
  { name: 'solary', display_name: 'Solary' },
  { name: 'koi', display_name: 'KOI' },
  { name: 'karminecorp', display_name: 'Karmine Corp' },
  { name: 'mandatory', display_name: 'Mandatory' },
  { name: 'ogaming', display_name: "O'Gaming" }
];

async function searchTwitchTeams(query) {
  if (!query || query.length < 2) return [];

  const q = query.toLowerCase();
  return KNOWN_TEAMS.filter(team =>
    team.name.toLowerCase().includes(q) ||
    team.display_name.toLowerCase().includes(q)
  );
}

async function addTwitchTeam(teamName) {
  try {
    const token = await getTwitchToken();
    if (!token) {
      return { success: false, error: 'Token Twitch manquant' };
    }

    const response = await fetch(`https://api.twitch.tv/helix/teams?name=${teamName}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
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

    const teamLogoUrl = team.thumbnail_url || team.background_image_url || null;
    if (teamLogoUrl) {
      const logoCacheKey = teamName.toLowerCase().trim();
      teamLogosCache[logoCacheKey] = teamLogoUrl;
      await chrome.storage.local.set({ [`teamLogo_${logoCacheKey}`]: teamLogoUrl });
    }

    const streamers = await getStreamersFromDB();
    let addedCount = 0;

    for (const user of teamUsers) {
      const existingIndex = streamers.findIndex(s =>
        s.platform === 'twitch' && s.username.toLowerCase() === user.user_login.toLowerCase()
      );

      if (existingIndex >= 0) {
        streamers[existingIndex].team = teamName;
        if (teamLogoUrl) streamers[existingIndex].teamLogo = teamLogoUrl;
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
          teamLogo: teamLogoUrl,
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
  if (isChecking && (Date.now() - checkStartedAt < CHECK_TIMEOUT)) {
    return;
  }

  try {
    isChecking = true;
    checkStartedAt = Date.now();

    const streamers = await getStreamersFromDB();
    const { settings = {} } = await chrome.storage.sync.get('settings');

    if (streamers.length === 0) {
      updateBadge(0);
      return;
    }

    const statusMap = new Map();
    const twitchStreamers = streamers.filter(s => s.platform === 'twitch');

    if (twitchStreamers.length > 0) {
      const twitchStatuses = await checkTwitchStatusBatch(twitchStreamers.map(s => s.username));
      for (const [username, status] of Object.entries(twitchStatuses)) {
        statusMap.set(`twitch_${username.toLowerCase()}`, status);
      }
    }

    const updatedStreamers = [];
    let liveCount = 0;

    for (const streamer of streamers) {
      try {
        const statusKey = `${streamer.platform}_${streamer.username.toLowerCase()}`;
        const data = statusMap.get(statusKey) || { isLive: false };

        const updated = { ...streamer, ...data };

        if (!updated.avatar || updated.avatar === '') {
          const cachedAvatar = await chrome.storage.local.get(`avatar_${streamer.id}`);
          if (cachedAvatar[`avatar_${streamer.id}`]) {
            updated.avatar = cachedAvatar[`avatar_${streamer.id}`];
          } else {
            updated.avatar = await getStreamerAvatar(streamer.platform, streamer.username);
          }
        }

        if (streamer.platform === 'twitch' && !updated.team) {
          const teamName = await getStreamerTeam(streamer.username);
          if (teamName) {
            updated.team = teamName;
          }
        }

        if (updated.team && !updated.teamLogo) {
          const logo = await getTeamLogo(updated.team);
          if (logo) {
            updated.teamLogo = logo;
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

        const wasLiveBefore = streamer.isLive === true;
        const isLiveNow = data.isLive === true;
        const recentlyNotified = await wasRecentlyNotified(streamer.id);

        if (isLiveNow && !wasLiveBefore && !recentlyNotified && settings.notifications !== false) {
          await sendNotification(updated);
          await setStreamerNotified(streamer.id);
        }

        if (!isLiveNow && wasLiveBefore) {
          await clearStreamerNotified(streamer.id);
        }

        if (data.isLive) {
          liveCount++;
          updated.priority = 'high';
        } else if (updated.wasLiveRecently) {
          updated.priority = 'medium';
        } else {
          updated.priority = 'normal';
        }

        updatedStreamers.push(updated);

        if (updated.avatar) {
          await chrome.storage.local.set({ [`avatar_${updated.id}`]: updated.avatar });
        }

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

    await updateAlarmInterval(liveCount);

  } catch (error) {
    console.error('[Nowtify] checkAllStreamers error:', error);
  } finally {
    isChecking = false;
  }
}

async function updateAlarmInterval(liveCount) {
  try {
    const { settings = {} } = await chrome.storage.sync.get('settings');
    const userInterval = parseInt(settings.refreshInterval) || 5;

    const intervalMinutes = liveCount > 0 ? 1 : userInterval;

    await chrome.alarms.clear('checkStreams');
    chrome.alarms.create('checkStreams', { periodInMinutes: intervalMinutes });
  } catch {}
}

async function checkTwitchStatusBatch(usernames) {
  const results = {};

  if (!TWITCH_CLIENT_ID || usernames.length === 0) {
    usernames.forEach(u => results[u.toLowerCase()] = { isLive: false, error: true });
    return results;
  }

  try {
    const token = await getTwitchToken();
    if (!token) {
      await setAuthErrorFlag(true);
      usernames.forEach(u => results[u.toLowerCase()] = { isLive: false, error: true });
      return results;
    }
    await setAuthErrorFlag(false);

    const chunks = [];
    for (let i = 0; i < usernames.length; i += 100) {
      chunks.push(usernames.slice(i, i + 100));
    }

    for (const chunk of chunks) {
      const params = chunk.map(u => `user_login=${encodeURIComponent(u)}`).join('&');
      const response = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          cachedToken = null;
          tokenValidatedAt = 0;
          await setAuthErrorFlag(true);
          await chrome.storage.local.remove('twitchAuth');
        }
        chunk.forEach(u => results[u.toLowerCase()] = { isLive: false, error: true });
        continue;
      }

      const data = await response.json();

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

async function getTwitchToken() {
  if (cachedToken && (Date.now() - tokenValidatedAt < TOKEN_REVALIDATE_INTERVAL)) {
    return cachedToken;
  }

  try {
    const { twitchAuth } = await chrome.storage.local.get('twitchAuth');

    if (!twitchAuth || !twitchAuth.access_token) {
      cachedToken = null;
      return null;
    }

    const validationResult = await validateTwitchToken(twitchAuth.access_token);
    if (validationResult === 'invalid') {
      await chrome.storage.local.remove('twitchAuth');
      cachedToken = null;
      tokenValidatedAt = 0;
      return null;
    }

    cachedToken = twitchAuth.access_token;
    if (validationResult === 'valid') {
      tokenValidatedAt = Date.now();
    }
    return cachedToken;
  } catch (error) {
    return null;
  }
}

async function validateTwitchToken(token) {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token}` }
    });
    if (response.ok) return 'valid';
    if (response.status === 401) return 'invalid';
    return 'network_error';
  } catch {
    return 'network_error';
  }
}

async function loginWithTwitch() {
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=`;

  try {
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    });

    const hashParams = new URLSearchParams(responseUrl.split('#')[1]);
    const accessToken = hashParams.get('access_token');

    if (accessToken) {
      await chrome.storage.local.set({
        twitchAuth: {
          access_token: accessToken,
          obtained_at: Date.now()
        }
      });
      cachedToken = accessToken;
      tokenValidatedAt = Date.now();
      await setAuthErrorFlag(false);

      const userInfo = await getTwitchUserInfo(accessToken);

      return { success: true, user: userInfo };
    }

    return { success: false, error: 'Token non reçu' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getTwitchUserInfo(token) {
  try {
    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.data && data.data[0]) {
        return {
          id: data.data[0].id,
          login: data.data[0].login,
          display_name: data.data[0].display_name,
          profile_image_url: data.data[0].profile_image_url
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function logoutTwitch() {
  cachedToken = null;
  tokenValidatedAt = 0;
  await chrome.storage.local.remove('twitchAuth');
  return { success: true };
}

async function getTwitchAuthStatus() {
  const { twitchAuth } = await chrome.storage.local.get('twitchAuth');

  if (!twitchAuth || !twitchAuth.access_token) {
    return { connected: false };
  }

  const validationResult = await validateTwitchToken(twitchAuth.access_token);
  if (validationResult === 'invalid') {
    await chrome.storage.local.remove('twitchAuth');
    return { connected: false };
  }

  const userInfo = await getTwitchUserInfo(twitchAuth.access_token);
  return { connected: true, user: userInfo };
}

async function getStreamerAvatar(platform, username) {
  try {
    if (platform !== 'twitch') return '';

    const token = await getTwitchToken();
    if (!token) return '';

    const response = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.data[0]?.profile_image_url || '';
    }
    return '';
  } catch (error) {
    return '';
  }
}

async function searchStreamers(query) {
  if (!query || query.length < 2) return [];

  try {
    return await searchTwitchStreamers(query);
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
          'Client-ID': TWITCH_CLIENT_ID,
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

function getTeamNameVariants(teamName) {
  const base = teamName.toLowerCase().trim();
  const variants = new Set([base]);

  variants.add(base.replace(/\s+/g, ''));
  variants.add(base.replace(/\s+/g, '_'));
  variants.add(base.replace(/\s+/g, '-'));
  variants.add(base.replace(/[^a-z0-9]/g, ''));
  variants.add(base.replace(/^team\s*/i, '').replace(/\s+/g, ''));

  return [...variants].filter(v => v.length > 0);
}

async function getTeamLogo(teamName) {
  if (!teamName) return null;

  const cacheKey = teamName.toLowerCase().trim();

  if (teamLogosCache[cacheKey]) {
    return teamLogosCache[cacheKey];
  }

  const stored = await chrome.storage.local.get(`teamLogo_${cacheKey}`);
  if (stored[`teamLogo_${cacheKey}`]) {
    teamLogosCache[cacheKey] = stored[`teamLogo_${cacheKey}`];
    return teamLogosCache[cacheKey];
  }

  try {
    const token = await getTwitchToken();
    if (!token) {
      return null;
    }

    const variants = getTeamNameVariants(teamName);

    for (const variant of variants) {
      try {
        const response = await fetch(`https://api.twitch.tv/helix/teams?name=${encodeURIComponent(variant)}`, {
          headers: {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data[0]) {
            let logoUrl = data.data[0].thumbnail_url || null;

            if (!logoUrl && data.data[0].background_image_url) {
              logoUrl = data.data[0].background_image_url;
            }

            if (logoUrl) {
              teamLogosCache[cacheKey] = logoUrl;
              await chrome.storage.local.set({ [`teamLogo_${cacheKey}`]: logoUrl });
              return logoUrl;
            }
          }
        } else if (response.status === 404) {
          continue;
        } else if (response.status === 401 || response.status === 403) {
          break;
        }
      } catch (fetchError) {
        continue;
      }
    }

    teamLogosCache[cacheKey] = null;
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
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!userResponse.ok) return null;

    const userData = await userResponse.json();
    if (!userData.data || userData.data.length === 0) return null;

    const userId = userData.data[0].id;

    const teamsResponse = await fetch(`https://api.twitch.tv/helix/teams/channel?broadcaster_id=${userId}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
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

  const enriched = streamers.map((streamer) => {
    const cached = streamersCache[streamer.id];
    if (cached) {
      if (cached.thumbnail && !streamer.thumbnail) streamer.thumbnail = cached.thumbnail;
      if (cached.game && !streamer.game) streamer.game = cached.game;
      if (cached.avatar && !streamer.avatar) streamer.avatar = cached.avatar;
      if (cached.teamLogo && !streamer.teamLogo) streamer.teamLogo = cached.teamLogo;
    }

    if (streamer.lastLiveDate) {
      const timeSince = Date.now() - streamer.lastLiveDate;
      streamer.wasLiveRecently = timeSince < CONFIG.RECENT_LIVE_THRESHOLD;
    }

    streamersCache[streamer.id] = streamer;
    return streamer;
  });

  return enriched;
}

function updateBadge(liveCount) {
  if (liveCount > 0) {
    const badgeText = liveCount > 99 ? '99+' : liveCount.toString();
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#5CFFE0' });
    chrome.action.setBadgeTextColor({ color: '#161618' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function getStreamerUrl(streamer) {
  if (streamer.platform === 'twitch') {
    return `https://twitch.tv/${streamer.username}`;
  }
  return null;
}

async function saveNotificationUrl(notificationId, url) {
  try {
    const { notificationUrls = {} } = await chrome.storage.local.get('notificationUrls');
    notificationUrls[notificationId] = url;

    const keys = Object.keys(notificationUrls);
    if (keys.length > 50) {
      keys.slice(0, keys.length - 50).forEach(k => delete notificationUrls[k]);
    }

    await chrome.storage.local.set({ notificationUrls });
  } catch {}
}

async function getNotificationUrl(notificationId) {
  try {
    const { notificationUrls = {} } = await chrome.storage.local.get('notificationUrls');
    return notificationUrls[notificationId] || null;
  } catch {
    return null;
  }
}

async function removeNotificationUrl(notificationId) {
  try {
    const { notificationUrls = {} } = await chrome.storage.local.get('notificationUrls');
    delete notificationUrls[notificationId];
    await chrome.storage.local.set({ notificationUrls });
  } catch {}
}

async function sendNotification(streamer) {
  return new Promise(async (resolve) => {
    try {
      const notificationId = `live-${streamer.id}-${Date.now()}`;
      const url = getStreamerUrl(streamer);

      if (url) {
        await saveNotificationUrl(notificationId, url);
      }

      const iconUrl = streamer.avatar && streamer.avatar.startsWith('http')
        ? streamer.avatar
        : chrome.runtime.getURL('icons/logo.png');

      const { settings = {} } = await chrome.storage.sync.get('settings');

      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: iconUrl,
        title: `${streamer.name} est en live !`,
        message: streamer.title || `${streamer.name} vient de commencer un stream sur ${streamer.platform}`,
        priority: 2,
        requireInteraction: settings.persistentNotifications === true,
        silent: false
      }, (createdId) => {
        if (chrome.runtime.lastError) {
          console.error('[Nowtify] Notification error:', chrome.runtime.lastError.message);
        }
        resolve(createdId);
      });

      await saveToHistory(streamer);
    } catch (error) {
      console.error('[Nowtify] sendNotification error:', error);
      resolve(null);
    }
  });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const url = await getNotificationUrl(notificationId);
  if (url) {
    chrome.tabs.create({ url });
    await removeNotificationUrl(notificationId);
  }
  chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
  await removeNotificationUrl(notificationId);
});

async function saveToHistory(streamer) {
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    if (changes.streamers?.newValue) {
      saveStreamersToDB(changes.streamers.newValue, true).catch(() => {});
    }
    if (changes.groups?.newValue) {
      saveGroupsToDB(changes.groups.newValue).catch(() => {});
    }
  }
});

migrateToIndexedDB().then(() => checkAllStreamers());

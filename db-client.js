// Client-side database helper for popup.js and options.js
// Uses message passing to communicate with background.js IndexedDB

const DB = {
  // Get all streamers
  async getStreamers() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getStreamers' });
      return response?.streamers || [];
    } catch (error) {
      console.warn('Failed to get streamers from IndexedDB, falling back:', error);
      const { streamers = [] } = await chrome.storage.sync.get('streamers');
      return streamers;
    }
  },

  // Save all streamers
  async saveStreamers(streamers) {
    try {
      await chrome.runtime.sendMessage({ action: 'saveStreamers', streamers });
      // Also sync to chrome.storage for backward compatibility
      await chrome.storage.sync.set({ streamers });
    } catch (error) {
      console.warn('Failed to save streamers to IndexedDB, using fallback:', error);
      await chrome.storage.sync.set({ streamers });
    }
  },

  // Get all groups
  async getGroups() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getGroups' });
      return response?.groups || [];
    } catch (error) {
      console.warn('Failed to get groups from IndexedDB, falling back:', error);
      const { groups = [] } = await chrome.storage.sync.get('groups');
      return groups;
    }
  },

  // Save all groups
  async saveGroups(groups) {
    try {
      await chrome.runtime.sendMessage({ action: 'saveGroups', groups });
      await chrome.storage.sync.set({ groups });
    } catch (error) {
      console.warn('Failed to save groups to IndexedDB, using fallback:', error);
      await chrome.storage.sync.set({ groups });
    }
  },

  // Get history
  async getHistory(limit = 50) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getHistory', limit });
      return response?.history || [];
    } catch (error) {
      console.warn('Failed to get history from IndexedDB, falling back:', error);
      const { history = [] } = await chrome.storage.local.get('history');
      return history.slice(0, limit);
    }
  },

  // Get settings (still uses chrome.storage.sync for small data)
  async getSettings() {
    const { settings = {} } = await chrome.storage.sync.get('settings');
    return settings;
  },

  // Save settings
  async saveSettings(settings) {
    await chrome.storage.sync.set({ settings });
  },

  // Get streamer order
  async getStreamerOrder() {
    const { streamerOrder = [] } = await chrome.storage.sync.get('streamerOrder');
    return streamerOrder;
  },

  // Save streamer order
  async saveStreamerOrder(order) {
    await chrome.storage.sync.set({ streamerOrder: order });
  }
};

const DB = {
  _send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      } catch {
        resolve(null);
      }
    });
  },

  async getStreamers() {
    const response = await this._send({ action: 'getStreamers' });
    return response?.streamers || [];
  },

  async getStreamersData() {
    const response = await this._send({ action: 'getStreamersData' });
    return response?.streamers || [];
  },

  async saveStreamers(streamers) {
    await this._send({ action: 'saveStreamers', streamers });
  },

  async addStreamer(streamer) {
    await this._send({ action: 'addStreamer', streamer });
  },

  async deleteStreamer(id) {
    await this._send({ action: 'deleteStreamer', id });
  },

  async deleteTeam(teamName) {
    await this._send({ action: 'deleteTeam', teamName });
  },

  async getGroups() {
    const response = await this._send({ action: 'getGroups' });
    return response?.groups || [];
  },

  async saveGroups(groups) {
    await this._send({ action: 'saveGroups', groups });
  },

  async addGroup(group) {
    await this._send({ action: 'addGroup', group });
  },

  async deleteGroup(groupId) {
    await this._send({ action: 'deleteGroup', groupId });
  },

  async getHistory(limit = 50) {
    const response = await this._send({ action: 'getHistory', limit });
    return response?.history || [];
  },

  async clearHistory() {
    await this._send({ action: 'clearHistory' });
  },

  async getAuthError() {
    const response = await this._send({ action: 'getAuthError' });
    return response?.hasAuthError || false;
  },

  async getSettings() {
    const { settings = {} } = await chrome.storage.sync.get('settings');
    return settings;
  },

  async saveSettings(settings) {
    await chrome.storage.sync.set({ settings });
  }
};

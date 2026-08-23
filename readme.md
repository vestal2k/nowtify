<div align="center">

  <img src="icons/logo.png" alt="Nowtify" width="72" height="72" />
  <h1>Nowtify</h1>
  <p><em>Get notified the moment your favorite Twitch streamers go live.</em></p>

  <p>
    <img src="https://img.shields.io/badge/Manifest-V3-5CFFE0?style=flat-square" alt="Manifest V3"/>
    <img src="https://img.shields.io/badge/License-MIT-7B5CFF?style=flat-square" alt="MIT License"/>
  </p>

  <p align="center">
    <img alt="Nowtify screenshot" src="icons/screenshot.png" width="100%" style="max-width:900px;border-radius:12px;">
  </p>

</div>

---

## Overview

Nowtify is a Chrome extension (Manifest V3) that watches your favorite Twitch
streamers and sends a native desktop notification as soon as one of them goes
live. Everything runs locally in the browser: there is no backend, no account,
and no data leaves your machine.

## Features

- Instant desktop notifications when a streamer goes live
- Toolbar badge showing how many streamers are currently live
- Popup dashboard with live, recently live, and offline states
- Streamer search with autocomplete powered by the Twitch API
- Twitch teams: add every member of a team at once
- Custom groups to organize your streamers
- Live thumbnail, category, and viewer count on hover
- History of the last detected lives
- Import and export of your data as JSON
- Compact grid mode
- Native dark interface

## Tech stack

- Chrome Extension Manifest V3, service worker background
- Vanilla JavaScript, no framework, no build step
- IndexedDB as the single source of truth for streamers, groups, and history
- Twitch Helix API
- `chrome.identity` OAuth (implicit grant, no client secret)
- ESLint flat config

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/qyrn/nowtify.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.

The extension needs a Twitch application to query the API. See the next section.

## Twitch API configuration

The extension authenticates against Twitch with its own registered Twitch
application (`TWITCH_CLIENT_ID` in `background.js`). No client secret is
required: the OAuth implicit flow runs entirely client-side, and each user's
access token stays local to their browser.

The extension's ID is pinned via the `key` field in `manifest.json`, so it's
identical whether loaded unpacked or installed from the Chrome Web Store:
`fejiomgldmdpflpichnebdecnhjghgde`. Its OAuth redirect URL
(`https://fejiomgldmdpflpichnebdecnhjghgde.chromiumapp.org/`) is already
registered on the Twitch application behind `TWITCH_CLIENT_ID` — no setup
needed, just load the extension and click **Se connecter avec Twitch** in
the options page.

If you fork this project and want to run your own Twitch application instead
(recommended if you plan to distribute your own build), replace the `key` in
`manifest.json` with your own (see `nowtify-key.pem` generation via
`openssl genrsa` / `openssl rsa -pubout`), register a Twitch app with a
redirect URL matching your new extension ID, and swap `TWITCH_CLIENT_ID` in
`background.js` accordingly.

## Project structure

```
background.js     Service worker: Twitch polling, notifications, IndexedDB
db-client.js      Unified data-access layer used by the UI pages
ui.js             Shared confirm modal and toast component
popup.html/js/css Toolbar popup dashboard
options.html/js/css Settings, groups, teams, history, import/export
icons/            Icons and default avatars
landing/          Static landing page
```

## Development

```
pnpm install
pnpm lint
```

## License

Released under the [MIT license](LICENSE). Free to use with attribution.

## Author

Developed by [qyrn](https://github.com/qyrn).

If you find Nowtify useful, you can support the project on
[Ko-fi](https://ko-fi.com/qyrnsec).

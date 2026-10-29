# Download Manager browser extension

One Manifest V3 codebase for Chrome, Edge, Brave, Opera, Vivaldi and Firefox (121+).

- **Captures browser downloads**: every download (or, optionally, only listed types / big
  files) goes to the app, which comes to the front and asks before starting. In Chrome-based
  browsers the native download (and its "Save as" dialog) is cancelled before it starts. If the
  app isn't running, the browser downloads the file as usual.
- **Right-click** a link, image, video or audio: "Download with Download Manager".
- **YouTube / TikTok**: a floating *Download* button on video pages opens a quality picker;
  the toolbar popup offers the same picker (and the whole playlist when watching inside one).
- The app shows "*Browser* connected" in its status bar while the extension is active.

## Install from the app

*Settings › Browser › Get extension* gives a copy already set to this app's address.

## Install (development / unpacked)

- **Chrome / Edge / Brave / Opera**: open `chrome://extensions` (`edge://extensions`), enable
  *Developer mode*, *Load unpacked*, pick this `extension/` folder.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, *Load Temporary Add-on*, pick
  `manifest.json`. Permanent installs need the zip signed on addons.mozilla.org.

`bun run extension:build` writes store-ready zips to `dist/`.

## Settings

Click the extension icon, then the gear. The app address is `http://127.0.0.1:17890` for the
desktop app; for the web/Docker version use the address you open it at (e.g. `http://localhost:8080`).

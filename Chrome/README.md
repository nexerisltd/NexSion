# NexSion

NexSion is a Chrome extension that turns your new tab into a polished, visual bookmark workspace. It combines boards, drag-and-drop organization, quick save, and a glassy dashboard experience in a single lightweight extension.

## Features

- Create multiple pages and organize bookmarks into boards
- Drag and drop links between boards
- Quick-save the current tab with a keyboard shortcut
- Search across links within a page or across all pages
- Import existing Chrome bookmarks into a dedicated Imported page
- Recently deleted links with restore support
- Privacy mode to blur titles for screen sharing
- Theme, wallpaper, and accent color customization
- Google sign-in support for account display and future sync scenarios

## Project structure

```text
nexsion/
├── manifest.json
├── background.js
├── newtab.html
├── popup.html
├── popup.js
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── auth.js
│   └── storage.js
└── icons/
```

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select the project folder containing `manifest.json`
5. Open a new tab and NexSion will appear as your new-tab dashboard

## Google sign-in setup

The extension uses Chrome identity and requires a Google OAuth client ID.

1. Load the extension once so Chrome assigns it an extension ID
2. Open `chrome://extensions` and copy the NexSion extension ID
3. Create an OAuth client ID in Google Cloud Console for a Chrome Extension
4. Replace the placeholder value in `manifest.json` with your real client ID

Important: do not commit or share your real client ID publicly. Keep it local or use a placeholder in public repositories.

## Permissions

The extension uses:

- `storage` for local data persistence
- `bookmarks` for bookmark import
- `tabs` for quick-save from the active tab
- `identity` for Google sign-in
- `notifications` for save confirmations
- `favicon` for bookmark icons
- `unlimitedStorage` for larger wallpaper uploads

## Usage

- Use the top page pills to switch between pages
- Add boards and links directly from the dashboard
- Use the right-side dock for search, import, privacy, settings, and trash
- Press `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac) to quickly save the current tab

## Development notes

- Data is currently stored locally in `chrome.storage.local`
- The UI is rendered from `js/app.js`
- Persistence and storage helpers live in `js/storage.js`
- Authentication logic is handled in `js/auth.js`

## Notes

This project is actively being developed. Future improvements may include true cross-device sync, richer collaboration, and more import/export options.

## Author

Arabi Islam
"# NexSion" 
"# NexSion" 

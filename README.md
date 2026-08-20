# NexSion

NexSion is a Chrome extension that turns your new tab into a polished, visual bookmark workspace. It combines boards, drag-and-drop organization, quick save, and a glassy dashboard experience in a single lightweight extension.

## Screenshots

### Home — Boards Dashboard
Your new tab becomes a glassy, organized dashboard. Create boards, drop links, switch pages.

![Home](assets/1__Home.png)

### Wallpaper & Theme
Choose from live/still wallpapers, switch Dark/Light style, or paste your own wallpaper URL (syncs across devices).

![Wallpaper](assets/2__Wallpaper.png)

### Search Boards
Instantly search across the current page or all pages, with an exact-match toggle.

![Search Boards](assets/3__Search_Boards.png)

### Bulk Select
Select multiple links at once to move, tag, or delete in one action.

![Bulk Select](assets/4__Bulk_Select.png)

### Widgets
Toggle Clock, Weather, Quote of the Day, and Notepad widgets on your dashboard.

![Widgets](assets/5__Widget.png)

### Recently Deleted (Trash Bin)
Nothing is lost immediately — restore deleted boards or links anytime.

![Trash Bin](assets/6__Trash_Bin.png)

### Privacy Mode
Blur all titles instantly — perfect for screen sharing or streaming.

![Privacy Mode](assets/7__Privacy_Mode.png)

### General Settings
Quick-save shortcut, link-opening behavior, performance mode, and a duplicate link finder.

![General Settings](assets/8__General.png)

### Account & Cloud Backup
Sign in, back up boards to the cloud, export/import a local backup file, or reset everything.

![Account](assets/9__Account.png)

### Updates
Link your unpacked extension folder once to enable automatic updates — no manual re-downloading.

![Updates](assets/10__Updates.png)

### New Board
Choose between a Links board or a Checklist board, name it, and create.

![New Board](assets/11__New_Board.png)

### Add Link
Save a URL with title, optional description, tags, and an optional reminder.

![Add Link](assets/12__Add_Link.png)

### New Page
Organize your boards across multiple named pages.

![New Page](assets/13__New_Page.png)

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

```
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
├── assets/
│   └── (screenshots used in this README)
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

## License

See [LICENSE.md](LICENSE.md).
# AI Memory Bridge Privacy Policy

Last updated: June 2, 2026

AI Memory Bridge is a browser extension for saving, organizing, injecting, and exporting AI conversation memories across supported AI chat platforms.

## Information the extension processes

The extension may process the following information when the user chooses to scan, save, export, or generate notes:

- AI conversation text visible on supported AI platform pages.
- User-selected prompts, AI replies, titles, tags, project groups, usage counts, and creation timestamps.
- File or attachment metadata visible in the conversation page, such as file name, file type, file size, and accessible file links.
- Page URL of the supported AI platform where a memory or group was saved.
- AI API settings entered by the user, including API endpoint, model name, and API key.

## How information is used

The extension uses this information to:

- Save selected conversation memories locally in the browser.
- Search, organize, tag, pin, group, and reuse saved memories.
- Inject saved memories into supported AI chat input boxes.
- Export saved memories and project groups as JSON or editable HTML notes.
- Generate AI-assisted notes when the user explicitly clicks the AI notes feature.

## Local storage

Saved memories, groups, settings, and AI API settings are stored using `chrome.storage.local` in the user's browser profile. The extension does not operate a separate backend server for storing user data.

## Third-party API transmission

When the user enables and uses the AI-assisted notes feature, selected conversation content and attachment metadata are sent to the AI API endpoint configured by the user. The API key is used only to authorize that request. Users should review the privacy and data handling policies of their selected API provider.

If the user does not configure or use AI-assisted notes, the extension does not send saved conversation content to an AI API.

## Clipboard access

The extension may write text to the clipboard when the user clicks copy or when injection falls back to copying text. The extension does not read clipboard contents.

## Data sharing and sale

The extension does not sell user data. The extension does not share user data with the developer's own backend service. Data is only transmitted to a third-party AI API provider when the user explicitly configures an API endpoint and uses the AI-assisted notes feature.

## User control

Users can:

- Delete individual memories and project groups.
- Clear all saved memories and groups.
- Export saved data as JSON.
- Remove the extension to stop all extension processing.
- Delete local extension data through the browser extension settings or browser profile data controls.

## Security

API requests are sent to the HTTPS endpoint configured by the user when AI-assisted notes are generated. Users should only configure trusted API endpoints.

## Contact

For privacy questions or removal requests, contact the publisher through the GitHub repository:

https://github.com/leonlee111/AI-Memory-Bridge

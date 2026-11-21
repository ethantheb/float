/**
 * Names for well-known sites people pin: the last fallback before the URL for tabs the
 * browser restored without a title, when history and bookmarks have none either.
 * Keys are a host (no `www.`), or a host and first path segment; a host also covers its subdomains.
 */
const NAMES: Record<string, string> = {
  'mail.google.com': 'Gmail',
  'calendar.google.com': 'Google Calendar',
  'drive.google.com': 'Google Drive',
  'docs.google.com': 'Google Docs',
  'docs.google.com/spreadsheets': 'Google Sheets',
  'docs.google.com/presentation': 'Google Slides',
  'docs.google.com/forms': 'Google Forms',
  'meet.google.com': 'Google Meet',
  'chat.google.com': 'Google Chat',
  'keep.google.com': 'Google Keep',
  'photos.google.com': 'Google Photos',
  'messages.google.com': 'Google Messages',
  'gemini.google.com': 'Gemini',
  'youtube.com': 'YouTube',
  'music.youtube.com': 'YouTube Music',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'notion.so': 'Notion',
  'notion.com': 'Notion',
  'slack.com': 'Slack',
  'discord.com': 'Discord',
  'web.whatsapp.com': 'WhatsApp',
  'web.telegram.org': 'Telegram',
  'messenger.com': 'Messenger',
  'outlook.live.com': 'Outlook',
  'outlook.office.com': 'Outlook',
  'outlook.office365.com': 'Outlook',
  'teams.microsoft.com': 'Microsoft Teams',
  'teams.live.com': 'Microsoft Teams',
  'mail.proton.me': 'Proton Mail',
  'mail.yahoo.com': 'Yahoo Mail',
  'app.fastmail.com': 'Fastmail',
  'open.spotify.com': 'Spotify',
  'x.com': 'X',
  'twitter.com': 'X',
  'reddit.com': 'Reddit',
  'linkedin.com': 'LinkedIn',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'chatgpt.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'figma.com': 'Figma',
  'linear.app': 'Linear',
  'trello.com': 'Trello',
  'app.asana.com': 'Asana',
  'todoist.com': 'Todoist',
  'feedly.com': 'Feedly',
  'news.ycombinator.com': 'Hacker News',
  'netflix.com': 'Netflix',
  'twitch.tv': 'Twitch',
  'dropbox.com': 'Dropbox',
  'icloud.com': 'iCloud',
};

/** The name of a well-known site at `url`, or ''. */
export function knownSiteName(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  const host = parsed.hostname.replace(/^www\./, '');
  const first = parsed.pathname.split('/')[1];
  if (first && NAMES[`${host}/${first}`]) return NAMES[`${host}/${first}`];
  // The host, then its parent domains: m.youtube.com → youtube.com.
  for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (Object.hasOwn(NAMES, h)) return NAMES[h];
  return '';
}

/**
 * Official gif_viewer.js (1.0.81) — show exported GIF from chrome.storage.local.
 * Click the image to download. Data expires after 5 minutes.
 */

const EXPIRY_MS = 300_000;

(async () => {
  const content = document.getElementById('content');
  if (!content) return;

  try {
    const result = await chrome.storage.local.get('exportedGifData');
    const data = result.exportedGifData as
      | { base64?: string; filename?: string; timestamp?: number }
      | undefined;

    if (!data || !data.base64 || !data.filename) {
      throw new Error('No GIF data found. The export may have expired.');
    }

    if (typeof data.timestamp === 'number' && Date.now() - data.timestamp > EXPIRY_MS) {
      throw new Error('GIF data expired. Please export again.');
    }

    const byteCharacters = atob(data.base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/gif' });
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = data.filename;

    const img = document.createElement('img');
    img.src = blobUrl;
    img.alt = data.filename;

    link.appendChild(img);
    content.appendChild(link);

    document.title = data.filename;

    await chrome.storage.local.remove('exportedGifData');
  } catch (error) {
    console.error('[GIF Viewer] Error:', error);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = error instanceof Error ? error.message : String(error);
    content.appendChild(errorDiv);
  }
})();

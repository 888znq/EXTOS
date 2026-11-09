chrome.action.onClicked.addListener(async function () {
  const url = chrome.runtime.getURL('index.html');

  // If the app window is already open, just focus it instead of opening a duplicate.
  const existingTabs = await chrome.tabs.query({ url });
  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.windows.update(tab.windowId, { focused: true });
        return;
      }

      chrome.windows.create({
        url: url,
        type: 'popup',
        width: 1280,
        height: 860
      });
    });

    // Handles the "reload after patch" request sent from index.js.
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === 'RELOAD_APP') {
        sendResponse({ ok: true });
        setTimeout(function () { chrome.runtime.reload(); }, 100);
      }
    });

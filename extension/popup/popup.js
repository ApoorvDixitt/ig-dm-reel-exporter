(() => {
  'use strict';

  const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

  let cachedThreadName = null;
  let activeTabId = null;

  const els = {
    notDm: document.getElementById('not-dm'),
    ready: document.getElementById('ready'),
    extracting: document.getElementById('extracting'),
    complete: document.getElementById('complete'),
    error: document.getElementById('error'),
    threadInfo: document.getElementById('thread-info'),
    threadInfoExtracting: document.getElementById('thread-info-extracting'),
    threadInfoComplete: document.getElementById('thread-info-complete'),
    extractBtn: document.getElementById('extract-btn'),
    progressBar: document.getElementById('progress-bar'),
    progressText: document.getElementById('progress-text'),
    completeText: document.getElementById('complete-text'),
    summaryBreakdown: document.getElementById('summary-breakdown'),
    downloadJson: document.getElementById('download-json'),
    extractAgain: document.getElementById('extract-again'),
    errorText: document.getElementById('error-text'),
    retryBtn: document.getElementById('retry-btn'),
    dateRangeSelect: document.getElementById('date-range-select'),
    customDateRange: document.getElementById('custom-date-range'),
    dateStart: document.getElementById('date-start'),
    dateEnd: document.getElementById('date-end'),
  };

  function hideAll() {
    els.notDm.classList.add('hidden');
    els.ready.classList.add('hidden');
    els.extracting.classList.add('hidden');
    els.complete.classList.add('hidden');
    els.error.classList.add('hidden');
  }

  function showState(name) {
    hideAll();
    const el = els[name];
    if (el) el.classList.remove('hidden');
  }

  function setThreadInfo(text) {
    [els.threadInfo, els.threadInfoExtracting, els.threadInfoComplete].forEach(el => {
      const strong = document.createElement('strong');
      strong.textContent = text;
      el.replaceChildren(strong);
    });
    els.extractBtn.textContent = `Extract Shared Links from ${text}`;
  }

  function renderCompletion(summary) {
    els.summaryBreakdown.replaceChildren();
    if (!summary) {
      els.completeText.textContent = 'Done!';
      return;
    }

    const unique = summary.uniqueShares || 0;
    els.completeText.textContent = `Done! ${unique} unique share${unique === 1 ? '' : 's'} found.`;

    const bc = summary.byCategory || {};
    const rows = [
      ['Reels', bc.reels || 0],
      ['Posts', bc.posts || 0],
      ['Carousels', bc.carousels || 0],
    ];
    for (const [label, val] of rows) {
      const row = document.createElement('div');
      row.className = 'summary-row';
      const keySpan = document.createElement('span');
      keySpan.textContent = label;
      const valSpan = document.createElement('span');
      valSpan.textContent = String(val);
      row.append(keySpan, valSpan);
      els.summaryBreakdown.appendChild(row);
    }

    const meta = document.createElement('div');
    meta.className = 'summary-meta';
    meta.textContent =
      `${summary.totalShareMessages || 0} sends · ` +
      `${summary.duplicatesInChat || 0} duplicate${summary.duplicatesInChat === 1 ? '' : 's'} · ` +
      `${summary.skipped || 0} skipped`;
    els.summaryBreakdown.appendChild(meta);

    // Show why shares were skipped (aids debugging a thin/empty export).
    const reasons = summary.skippedByReason && Object.entries(summary.skippedByReason);
    if (reasons && reasons.length) {
      const reasonLine = document.createElement('div');
      reasonLine.className = 'summary-meta';
      reasonLine.textContent = 'skipped: ' + reasons.map(([r, c]) => `${r} ${c}`).join(', ');
      els.summaryBreakdown.appendChild(reasonLine);
    }
  }

  async function getActiveTab() {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // Must stay in sync with manifest.json content_scripts.
  const CONTENT_SCRIPTS = [
    'content/parser.js',
    'content/downloader.js',
    'content/extractor.js',
    'content/content.js',
  ];

  async function injectIfNeeded(tabId) {
    try {
      await browserAPI.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRIPTS,
      });
    } catch (_) {}
  }

  async function sendToContent(tab, message) {
    await injectIfNeeded(tab.id);

    // Use scripting.executeScript with a func to communicate.
    // tabs.sendMessage fails in Chrome when both manifest and programmatic
    // injection have run — Chrome returns null instead of the response.
    try {
      const [result] = await browserAPI.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (msg) => {
          // This runs in the same isolated world as the content scripts.
          // Dispatch the message directly to our handler via a global.
          if (typeof window.__igDmHandleMessage === 'function') {
            return await window.__igDmHandleMessage(msg);
          }
          return null;
        },
        args: [message],
      });
      return result?.result ?? null;
    } catch (_) {
      return null;
    }
  }

  async function checkPage() {
    const tab = await getActiveTab();
    if (!tab) {
      showState('notDm');
      return;
    }

    // Skip tab.url check — Firefox doesn't provide tab.url with activeTab permission.
    // Let the content script determine if we're on a DM page via CHECK_PAGE response.
    activeTabId = tab.id;

    const resp = await sendToContent(tab, { type: 'CHECK_PAGE' });
    if (!resp || !resp.onDmPage) {
      showState('notDm');
      const mark = document.createElement('mark');
      const bold = document.createElement('b');
      bold.textContent = 'full view';
      mark.appendChild(bold);
      els.notDm.replaceChildren('Open a DM conversation in ', mark, ' to extract shared links.');
      return;
    }

    cachedThreadName = resp.chatTitle || null;
    if (cachedThreadName) setThreadInfo(cachedThreadName);

    switch (resp.status) {
      case 'extracting':
        showState('extracting');
        els.progressText.textContent = `Page ${resp.page} — ${resp.totalMessages} shares`;
        break;
      case 'complete':
        showState('complete');
        renderCompletion(resp.summary);
        break;
      case 'error':
        showState('error');
        els.errorText.textContent = resp.error || 'An error occurred.';
        break;
      default: {
        showState('ready');
        // Try instant DOM scrape first, then async API fallback
        if (!cachedThreadName) {
          try {
            const [r] = await browserAPI.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                try {
                  // Strategy 1: header area span with title attr (display name)
                  const headerSpan = document.querySelector('header span[title]');
                  if (headerSpan?.title) return headerSpan.title;
                  // Strategy 2: Instagram class combo for DM header name
                  const el = document.querySelector('.x1lliihq.x193iq5w.x6ikm8r.x10wlt62.xlyipyv.xuxw1ft');
                  if (el) {
                    const inner = el.querySelector('span[title]');
                    if (inner?.title) return inner.title;
                    if (el.textContent?.trim()) return el.textContent.trim();
                  }
                  // Strategy 3: any span[title] in the main thread area
                  const allTitled = document.querySelectorAll('div[role="main"] span[title]');
                  if (allTitled.length === 1 && allTitled[0].title) return allTitled[0].title;
                } catch (e) {
                  return 'DOM_ERROR:' + e.message;
                }
                return null;
              },
            });
            if (r?.result && typeof r.result === 'string' && !r.result.startsWith('DOM_ERROR')) {
              cachedThreadName = r.result;
            }
          } catch (_) {}
        }
        if (cachedThreadName) {
          setThreadInfo(cachedThreadName);
        }
        // Async API fallback if DOM scrape didn't work
        if (!cachedThreadName) {
          sendToContent(tab, { type: 'GET_CHAT_NAME' }).then(name => {
            if (name) {
              cachedThreadName = name;
              setThreadInfo(name);
            }
          }).catch(() => {});
        }
        break;
      }
    }
  }

  els.dateRangeSelect.addEventListener('change', () => {
    const val = els.dateRangeSelect.value;
    if (val === 'custom') {
      els.customDateRange.classList.remove('hidden');
    } else {
      els.customDateRange.classList.add('hidden');
    }
  });

  // Human-readable mode label per selectable range (drives extractionWindow.mode).
  const DAY_MODES = {
    1: 'past_1_day',
    7: 'past_7_days',
    30: 'past_30_days',
    180: 'past_6_months',
    365: 'past_1_year',
    730: 'past_2_years',
  };

  /**
   * Returns { dateFilter, window } where dateFilter is the seconds-based
   * {startUnix,endUnix} the content script filters on (or null for "all"),
   * and window is the { mode, requestedStart, requestedEnd } metadata threaded
   * into extractionWindow.
   */
  function computeWindowAndFilter() {
    const val = els.dateRangeSelect.value;
    const nowSecs = Math.floor(Date.now() / 1000);
    const iso = (unixSecs) => new Date(unixSecs * 1000).toISOString();

    if (val === 'all') {
      return {
        dateFilter: null,
        window: { mode: 'all', requestedStart: null, requestedEnd: null },
      };
    }

    if (val === 'custom') {
      let startStr = els.dateStart.value;
      let endStr = els.dateEnd.value;
      if (!startStr && !endStr) {
        // both empty = all messages
        return {
          dateFilter: null,
          window: { mode: 'custom', requestedStart: null, requestedEnd: null },
        };
      }
      if (startStr && endStr && startStr > endStr) [startStr, endStr] = [endStr, startStr];
      const startUnix = startStr ? Math.floor(new Date(startStr + 'T00:00:00').getTime() / 1000) : 0;
      const endUnix = endStr ? Math.floor(new Date(endStr + 'T23:59:59').getTime() / 1000) : nowSecs;
      return {
        dateFilter: { startUnix, endUnix },
        window: {
          mode: 'custom',
          requestedStart: startStr ? new Date(startStr + 'T00:00:00').toISOString() : null,
          requestedEnd: endStr ? new Date(endStr + 'T23:59:59').toISOString() : null,
        },
      };
    }

    const days = parseInt(val, 10);
    const startUnix = nowSecs - days * 86400;
    return {
      dateFilter: { startUnix, endUnix: nowSecs },
      window: {
        mode: DAY_MODES[days] || `past_${days}_days`,
        requestedStart: iso(startUnix),
        requestedEnd: iso(nowSecs),
      },
    };
  }

  async function startExtraction() {
    const tab = await getActiveTab();
    if (!tab) return;

    showState('extracting');
    if (cachedThreadName) setThreadInfo(cachedThreadName);
    els.progressText.textContent = 'Starting...';
    els.progressBar.style.width = '0%';
    els.progressBar.classList.add('indeterminate');

    const { dateFilter, window } = computeWindowAndFilter();
    const resp = await sendToContent(tab, { type: 'START_EXTRACTION', dateFilter, window });
    if (!resp || !resp.started) {
      showState('ready');
      if (cachedThreadName) setThreadInfo(cachedThreadName);
    }
  }

  // Listen for messages from content script
  browserAPI.runtime.onMessage.addListener((msg, sender) => {
    if (sender.tab && sender.tab.id !== activeTabId) return;
    if (msg.type === 'PROGRESS') {
      showState('extracting');
      els.progressBar.classList.remove('indeterminate');
      const pct = Math.min(95, msg.page * 5); // Indeterminate-ish progress
      els.progressBar.style.width = `${pct}%`;
      els.progressText.textContent = `Page ${msg.page} — ${msg.totalMessages} scanned`;
      if (msg.chatTitle) {
        cachedThreadName = msg.chatTitle;
        setThreadInfo(msg.chatTitle);
      }
    } else if (msg.type === 'COMPLETE') {
      showState('complete');
      els.progressBar.classList.remove('indeterminate');
      els.progressBar.style.width = '100%';
      if (msg.chatTitle) {
        cachedThreadName = msg.chatTitle;
        setThreadInfo(msg.chatTitle);
      }
      renderCompletion(msg.summary);
    } else if (msg.type === 'EXTRACTION_ERROR') {
      showState('error');
      els.errorText.textContent = msg.error || 'An error occurred.';
    }
  });

  els.extractBtn.addEventListener('click', startExtraction);
  els.extractAgain.addEventListener('click', () => {
    showState('ready');
    if (cachedThreadName) setThreadInfo(cachedThreadName);
  });
  els.retryBtn.addEventListener('click', startExtraction);

  els.downloadJson.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;
    const resp = await sendToContent(tab, { type: 'DOWNLOAD_JSON' });
    if (resp && !resp.downloaded) {
      els.completeText.textContent = resp.error || 'Download failed.';
    }
  });

  // Initial check
  checkPage();
})();

(function () {
  var messages = [];
  var pendingConfirmation = null;
  var isBusy = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /**
   * Lightweight, XSS-safe markdown renderer for assistant messages.
   * Supports: fenced code blocks, ```chart JSON ``` blocks (rendered as an
   * attractive SVG bar chart via charts.js), ![alt](url) images, `code`,
   * **bold**, *italic*, [links](url), # headings, lists, --- rules, and
   * paragraph grouping. Everything is HTML-escaped first; block content is
   * stored as opaque tokens so it is never re-interpreted as inline markdown.
   */
  function renderMarkdown(text) {
    var tokens = [];
    function makeToken(html) {
      tokens.push(html);
      return '\u0000B' + (tokens.length - 1) + '\u0000';
    }

    // 1) Extract fenced code / chart blocks BEFORE anything else.
    var work = String(text).replace(/```([a-z0-9_-]*)[^\n\r]*\r?\n([\s\S]*?)(?:\r?\n)?```/g, function (m, lang, body) {
      var rendered;
      if (lang && lang.toLowerCase() === 'chart') {
        try {
          var spec = JSON.parse(body);
          if (typeof window !== 'undefined' && typeof window.renderAssistantChart === 'function') {
            rendered = window.renderAssistantChart(spec);
          }
        } catch (e) { /* not valid JSON — fall back to showing raw code */ }
      }
      var codeHtml = '<pre class="assistant-pre"><code>' + escapeHtml(body) + '</code></pre>';
      return makeToken(rendered ? '<div class="assistant-chart">' + rendered + '</div>' : codeHtml);
    });

    // 2) Escape everything that remains.
    var escaped = escapeHtml(work);

    // 3) Images: ![alt](url) — only http(s) is allowed.
    escaped = escaped.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (m, alt, url) {
      if (!/^https?:\/\//i.test(url)) return '';
      return makeToken('<img class="assistant-image" src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling && (this.nextElementSibling.style.display=\'block\');" /><span class="assistant-image-fallback" style="display:none"><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(alt || 'Open link') + '</a></span>');
    });

    // 4) Inline code first so markdown inside isn't parsed.
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="assistant-code">$1</code>');

    // 5) Links: [text](url) — block unsafe schemes.
    escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, linkText, url) {
      if (/^(javascript|data|vbscript):/i.test(url)) return linkText;
      return makeToken('<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + linkText + '</a>');
    });

    // 6) Bold, then italic (after bold so ** borders aren't matched).
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong class="assistant-bold">$1</strong>');
    escaped = escaped.replace(/\*[^*]+\*/g, function (m) {
      return '<em>' + m.slice(1, -1) + '</em>';
    });

    // 7) Block-level: headings, rules, bullet/ordered lists, paragraph runs.
    var lines = escaped.split('\n');
    var out = [];
    var para = [];
    var inUl = false;
    var inOl = false;

    function closeLists() {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    }
    function flushPara() {
      if (para.length) {
        out.push('<p class="assistant-p">' + para.join('<br>') + '</p>');
        para = [];
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (!trimmed) { flushPara(); closeLists(); continue; }

      var heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
      var hrMatch = /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed);
      var bulletMatch = trimmed.match(/^[-•]\s+(.*)$/);
      var numMatch = trimmed.match(/^(\d+)[.)]\s+(.*)$/);

      if (heading) {
        flushPara(); closeLists();
        var lvl = heading[1].length;
        out.push('<h' + lvl + ' class="assistant-heading">' + heading[2] + '</h' + lvl + '>');
      } else if (hrMatch) {
        flushPara(); closeLists();
        out.push('<div class="assistant-hr"></div>');
      } else if (bulletMatch) {
        flushPara();
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (!inUl) { out.push('<ul class="assistant-list">'); inUl = true; }
        out.push('<li>' + bulletMatch[1] + '</li>');
      } else if (numMatch) {
        flushPara();
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (!inOl) { out.push('<ol class="assistant-list">'); inOl = true; }
        out.push('<li>' + numMatch[2] + '</li>');
      } else {
        closeLists();
        para.push(line);
      }
    }
    flushPara(); closeLists();

    // 8) Restore the opaque tokens (code blocks / charts / images / links).
    return out.join('\n').replace(/\u0000B(\d+)\u0000/g, function (m, idx) {
      return tokens[Number(idx)] || '';
    });
  }

  /**
   * Format message content for display.
   * Assistant messages get markdown rendering; user messages stay plain.
   */
  function formatContent(content, role) {
    if (role === 'assistant') return renderMarkdown(content);
    return escapeHtml(content).replace(/\n/g, '<br>');
  }

  function render() {
    var log = document.getElementById('assistant-messages');
    var confirmation = document.getElementById('assistant-confirmation');
    if (!log) return;
    var visibleMessages = messages.filter(function (item) {
      return (item.role === 'user' || item.role === 'assistant') && item.content;
    });
    var bubbles = visibleMessages.length
      ? visibleMessages.map(function (item) {
        return '<div class="assistant-message assistant-message-' + item.role + '"><strong>' +
          escapeHtml(item.role === 'user' ? 'You' : 'Assistant') + '</strong><div>' +
          formatContent(item.content, item.role) + '</div></div>';
      }).join('')
      : '<p class="empty-state">Ask about releases, tickets, story points, actual points, PRs, or Jira status.</p>';
    if (isBusy && visibleMessages.length) {
      bubbles += '<div class="assistant-message assistant-message-thinking"><strong>' +
        escapeHtml('Assistant') + '</strong><div><span class="assistant-thinking">' +
        '<span class="assistant-thinking-dot"></span>' +
        '<span class="assistant-thinking-dot"></span>' +
        '<span class="assistant-thinking-dot"></span>' +
        '<span class="assistant-thinking-text">Thinking</span></span></div></div>';
    }
    log.innerHTML = bubbles;
    log.scrollTop = log.scrollHeight;
    if (confirmation) {
      confirmation.hidden = !pendingConfirmation;
      confirmation.innerHTML = pendingConfirmation
        ? '<span>Confirm Jira update for <strong>' + escapeHtml(pendingConfirmation.issueKey) +
          '</strong>: set <strong>' + escapeHtml(pendingConfirmation.field) + '</strong> to <strong>' +
          escapeHtml(pendingConfirmation.value) + '</strong>.</span><button id="assistant-confirm" class="refresh-button" type="button">Confirm update</button>'
        : '';
      var confirmButton = document.getElementById('assistant-confirm');
      if (confirmButton) confirmButton.addEventListener('click', confirmUpdate);
    }
  }

  function setBusy(busy) {
    isBusy = busy;
    var button = document.getElementById('assistant-send');
    var input = document.getElementById('assistant-input');
    if (button) button.disabled = busy;
    if (input) input.disabled = busy;
  }

  function sendMessage() {
    var input = document.getElementById('assistant-input');
    var content = input && input.value.trim();
    if (!content) return;
    messages.push({ role: 'user', content: content });
    input.value = '';
    pendingConfirmation = null;
    setBusy(true);
    render();
    fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages }),
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Assistant request failed.');
          return payload;
        });
      })
      .then(function (payload) {
        isBusy = false;
        messages = payload.messages || messages;
        var lastMessage = messages[messages.length - 1];
        if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.content !== payload.message) {
          messages.push({ role: 'assistant', content: payload.message || '' });
        }
        pendingConfirmation = payload.confirmation || null;
        render();
      })
      .catch(function (error) {
        isBusy = false;
        messages.push({ role: 'assistant', content: 'Error: ' + error.message });
        render();
      })
      .finally(function () { setBusy(false); });
  }

  function confirmUpdate() {
    if (!pendingConfirmation) return;
    setBusy(true);
    render();
    fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: pendingConfirmation }),
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok || !payload.ok) throw new Error(payload.error || 'Jira update failed.');
          return payload;
        });
      })
      .then(function () {
        isBusy = false;
        messages.push({ role: 'assistant', content: 'The Jira update was applied and the dashboard is refreshing.' });
        pendingConfirmation = null;
        render();
      })
      .catch(function (error) {
        isBusy = false;
        messages.push({ role: 'assistant', content: 'Update error: ' + error.message });
        render();
      })
      .finally(function () { setBusy(false); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('assistant-form');
    if (!form) return;
    var modal = document.getElementById('assistant-modal');
    var launcher = document.getElementById('assistant-launcher');
    var closeButton = document.getElementById('assistant-close');
    function closeAssistant() {
      if (modal) modal.hidden = true;
    }
    function openAssistant() {
      if (!modal) return;
      modal.hidden = false;
      var input = document.getElementById('assistant-input');
      if (input) input.focus();
    }
    if (launcher) launcher.addEventListener('click', openAssistant);
    if (closeButton) closeButton.addEventListener('click', closeAssistant);
    if (modal) {
      modal.addEventListener('click', function (event) {
        if (event.target === modal) closeAssistant();
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modal && !modal.hidden) closeAssistant();
    });
    form.addEventListener('submit', function (event) { event.preventDefault(); sendMessage(); });
    render();
  });
}());
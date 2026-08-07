// Browser-only state/rendering. Plain JS, no import/export, wrapped in an IIFE
// so its own helpers stay off the global scope — but it freely calls the
// un-wrapped global functions from deliveryMath.js (inlined in the <script>
// tag just before this one in dashboard/render.js's output).
(function () {
  var DATA = window.__DASHBOARD_DATA__;

  function getReleaseNames() {
    return DATA.releases.map(function (r) { return r.name; });
  }

  function parseReleaseTokens(value) {
    return value
      .split(',')
      .map(function (token) { return token.trim(); })
      .filter(function (token) { return token.length > 0; });
  }

  function getQuerySelectedReleases() {
    if (typeof window === 'undefined' || !window.location || typeof window.location.search !== 'string') {
      return [];
    }
    var params = new URLSearchParams(window.location.search);
    var releases = [];
    params.getAll('releases').forEach(function (value) {
      parseReleaseTokens(value).forEach(function (name) {
        releases.push(name);
      });
    });
    return releases;
  }

  function getDefaultSelectedReleaseNames() {
    var validNames = new Set(getReleaseNames());
    var queryReleases = getQuerySelectedReleases().filter(function (name) { return validNames.has(name); });
    if (queryReleases.length > 0) {
      return queryReleases;
    }
    if (Array.isArray(DATA.default_selected_releases) && DATA.default_selected_releases.length > 0) {
      return DATA.default_selected_releases.filter(function (name) { return validNames.has(name); });
    }
    return getReleaseNames();
  }

  var state = {
    selectedReleases: new Set(getDefaultSelectedReleaseNames()),
    selectedDeveloper: null,
    selectedRepoOpenPrs: [],
    selectedRepoName: '',
    ticketFilters: { status: '', issueType: '', developer: '' },
    sortState: { column: null, direction: 'desc' },
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function fmtNum(value, digits) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    return value.toLocaleString(undefined, { maximumFractionDigits: digits || 0 });
  }

  function fmtPercent(value) {
    return typeof value === 'number' && !Number.isNaN(value) ? Math.round(value) + '%' : '—';
  }

  function getVisibleTickets() {
    return filterTicketsBySelectedReleases(DATA.tickets, Array.from(state.selectedReleases));
  }

  function getFilteredSortedTickets() {
    var tickets = getVisibleTickets().slice();
    var f = state.ticketFilters;
    if (f.status) tickets = tickets.filter(function (t) { return t.status === f.status; });
    if (f.issueType) tickets = tickets.filter(function (t) { return t.issue_type === f.issueType; });
    if (f.developer) tickets = tickets.filter(function (t) { return t.assignee_account_id === f.developer; });

    var sort = state.sortState;
    if (sort.column) {
      tickets.sort(function (a, b) {
        var av = a[sort.column];
        var bv = b[sort.column];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return sort.direction === 'asc' ? -1 : 1;
        if (av > bv) return sort.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return tickets;
  }

  function kpiTile(label, value) {
    return (
      '<div class="card kpi-tile"><span class="stat-label">' +
      escapeHtml(label) +
      '</span><span class="stat-value">' +
      value +
      '</span></div>'
    );
  }

  function getEditableDisplayValue(field, ticket) {
    if (field === 'summary') return ticket.summary || '';
    if (field === 'status') return ticket.status || '';
    if (field === 'assignee') return ticket.assignee_account_id || '';
    if (field === 'issue_type') return ticket.issue_type || '';
    if (field === 'sp') return ticket.sp == null ? '' : ticket.sp;
    if (field === 'ap') return ticket.ap == null ? '' : ticket.ap;
    if (field === 'ai_contribution_percent') return ticket.ai_contribution_percent == null ? '' : ticket.ai_contribution_percent;
    return '';
  }

  function getAssigneeOptions() {
    var developers = new Map();
    Object.values(DATA.tickets).forEach(function (ticket) {
      if (ticket.assignee_account_id) {
        developers.set(ticket.assignee_account_id, ticket.assignee_display_name || ticket.assignee_account_id);
      }
    });
    return Array.from(developers.entries()).map(function (entry) {
      return { value: entry[0], label: entry[1] };
    });
  }

  function getTicketStatusOptions() {
    var statuses = getVisibleTickets()
      .map(function (ticket) { return ticket.status; })
      .filter(function (value) { return Boolean(value); });
    return Array.from(new Set(statuses)).sort(function (a, b) {
      return String(a).localeCompare(String(b));
    });
  }

  function getIssueTypeOptions() {
    var issueTypes = getVisibleTickets()
      .map(function (ticket) { return ticket.issue_type; })
      .filter(function (value) { return Boolean(value); });
    return Array.from(new Set(issueTypes)).sort(function (a, b) {
      return String(a).localeCompare(String(b));
    });
  }

  function buildInlineEditorConfig(field, ticket) {
    var value = getEditableDisplayValue(field, ticket);
    if (field === 'status') {
      return { type: 'select', value: value, options: getTicketStatusOptions() };
    }
    if (field === 'assignee') {
      var options = [{ value: '', label: 'Unassigned' }].concat(getAssigneeOptions());
      return { type: 'select', value: value, options: options };
    }
    if (field === 'issue_type') {
      return { type: 'select', value: value, options: getIssueTypeOptions() };
    }
    return { type: 'input', value: value, options: [] };
  }

  function normalizeInlineEditValue(field, value) {
    if (value === '' || value == null) {
      return field === 'sp' || field === 'ap' || field === 'ai_contribution_percent' ? null : '';
    }

    if (field === 'sp' || field === 'ap' || field === 'ai_contribution_percent') {
      var numericValue = Number(value);
      return Number.isNaN(numericValue) ? value : numericValue;
    }

    return value;
  }

  function renderEditableCell(ticket, field) {
    var value = getEditableDisplayValue(field, ticket);
    var text = '—';
    if (field === 'assignee') {
      text = escapeHtml(ticket.assignee_display_name || 'Unassigned');
    } else {
      text = value === '' ? '—' : escapeHtml(value);
    }
    return '<td class="editable-cell" data-ticket-key="' + escapeHtml(ticket.key) + '" data-field="' + escapeHtml(field) + '" title="Click to edit">' + text + '</td>';
  }

  function saveInlineTicketEdit(cell, ticket, field, control) {
    if (cell.__saving) return;
    var nextValue = normalizeInlineEditValue(field, control.value);
    var currentValue = getEditableDisplayValue(field, ticket);
    if (nextValue === currentValue || (nextValue == null && currentValue === '') || (nextValue != null && String(nextValue) === String(currentValue))) {
      cell.classList.remove('is-editing');
      cell.innerHTML = escapeHtml(getEditableDisplayValue(field, ticket));
      return;
    }

    cell.__saving = true;
    cell.classList.add('is-saving');
    control.disabled = true;

    fetch('/api/tickets/' + encodeURIComponent(ticket.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { [field]: nextValue } }),
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || 'Unable to update Jira.');
          }
          return payload;
        });
      })
      .then(function (payload) {
        var updatedTicket = payload.ticket || Object.assign({}, ticket, { [field]: nextValue });
        DATA.tickets[ticket.key] = updatedTicket;
        window.__DASHBOARD_DATA__ = { ...window.__DASHBOARD_DATA__, tickets: DATA.tickets };
        renderAll();
      })
      .catch(function (error) {
        window.alert(error.message);
        cell.classList.remove('is-editing');
        cell.innerHTML = escapeHtml(getEditableDisplayValue(field, ticket));
      })
      .finally(function () {
        cell.__saving = false;
        cell.classList.remove('is-saving');
      });
  }

  function openInlineTicketEditor(cell) {
    if (cell.__saving || cell.classList.contains('is-editing')) return;
    var ticketKey = cell.getAttribute('data-ticket-key');
    var field = cell.getAttribute('data-field');
    var ticket = DATA.tickets[ticketKey];
    if (!ticket) return;

    var config = buildInlineEditorConfig(field, ticket);
    var controlHtml = config.type === 'select'
      ? '<select class="inline-edit-control">' + config.options.map(function (option) {
        var optionValue = typeof option === 'object' ? option.value : option;
        var optionLabel = typeof option === 'object' ? option.label : option;
        var selected = String(optionValue) === String(config.value) ? 'selected' : '';
        return '<option value="' + escapeHtml(optionValue) + '" ' + selected + '>' + escapeHtml(optionLabel) + '</option>';
      }).join('') + '</select>'
      : '<input class="inline-edit-control" type="text" value="' + escapeHtml(config.value) + '" />';

    cell.classList.add('is-editing');
    cell.innerHTML = controlHtml;

    var control = cell.querySelector('.inline-edit-control');
    if (control && typeof control.focus === 'function') {
      control.focus();
      if (typeof control.select === 'function' && control.tagName === 'INPUT') {
        control.select();
      }
    }

    control.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveInlineTicketEdit(cell, ticket, field, control);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cell.classList.remove('is-editing');
        cell.innerHTML = escapeHtml(getEditableDisplayValue(field, ticket));
      }
    });

    control.addEventListener('blur', function () {
      saveInlineTicketEdit(cell, ticket, field, control);
    });
  }

  function bindInlineTicketEditing(container) {
    if (container.__inlineEditBound) return;
    container.addEventListener('click', function (event) {
      var cell = event.target && event.target.closest ? event.target.closest('.editable-cell') : null;
      if (!cell) return;
      openInlineTicketEditor(cell);
    });
    container.__inlineEditBound = true;
  }

  function statPair(label, value) {
    return (
      '<div><span class="stat-label">' +
      escapeHtml(label) +
      '</span><span class="stat-value">' +
      value +
      '</span></div>'
    );
  }

  function prLinksHtml(ticket) {
    if (!ticket.linked_prs || ticket.linked_prs.length === 0) {
      return '<span class="empty-state">No linked PR found</span>';
    }
    return ticket.linked_prs
      .map(function (pr) {
        return (
          '<a href="' +
          escapeHtml(pr.pr_url) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(pr.repo.split('/')[1]) +
          ' #' +
          pr.pr_number +
          '</a> (' +
          escapeHtml(pr.pr_state) +
          ')'
        );
      })
      .join('<br>');
  }

  function renderReleasePicker() {
    var el = document.getElementById('release-picker');
    el.innerHTML = DATA.releases
      .map(function (r) {
        var checked = state.selectedReleases.has(r.name) ? 'checked' : '';
        var id = 'release-cb-' + r.name.replace(/[^a-zA-Z0-9]/g, '-');
        return (
          '<label class="release-option" for="' +
          id +
          '"><input type="checkbox" id="' +
          id +
          '" data-release="' +
          escapeHtml(r.name) +
          '" ' +
          checked +
          ' /><span>' +
          escapeHtml(r.name) +
          (r.released ? ' <span class="released-tag">released</span>' : '') +
          '</span></label>'
        );
      })
      .join('');

    Array.prototype.forEach.call(el.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () {
        var name = cb.getAttribute('data-release');
        if (cb.checked) state.selectedReleases.add(name);
        else state.selectedReleases.delete(name);
        renderAll();
      });
    });
  }

  function renderReleaseSummary() {
    var el = document.getElementById('release-summary');
    var summary = computeReleaseSummary(getVisibleTickets());
    var aiValue =
      fmtPercent(summary.team_ai_contribution_percent) +
      (summary.total_tickets > 0
        ? ' <span class="coverage-note">(' + summary.team_ai_contribution_coverage + '/' + summary.total_tickets + ' tickets)</span>'
        : '');

    el.innerHTML =
      '<div class="kpi-row">' +
      kpiTile('Total tickets', fmtNum(summary.total_tickets)) +
      kpiTile('Completed', fmtNum(summary.completed_tickets)) +
      kpiTile('Remaining', fmtNum(summary.remaining_tickets)) +
      kpiTile('Planned SP', fmtNum(summary.total_planned_sp)) +
      kpiTile('Delivered AP', fmtNum(summary.total_delivered_ap)) +
      kpiTile('Team AI contribution', aiValue) +
      '</div>';
  }

  function renderReleaseProgress() {
    var el = document.getElementById('release-progress');
    var series = buildReleaseProgressSeries(getVisibleTickets());
    var apChart = buildLineChart(
      [{ name: 'Delivered AP', points: series.cumulative_ap_by_day }],
      { referenceLine: { label: 'Planned SP', value: series.total_planned_sp }, ariaLabel: 'Cumulative AP delivered vs. planned SP' },
    );
    var completedChart = buildLineChart(
      [{ name: 'Tickets completed', points: series.cumulative_tickets_completed_by_day }],
      { ariaLabel: 'Cumulative tickets completed' },
    );
    el.innerHTML =
      '<div class="two-col">' +
      '<div class="card"><h3>Delivered AP vs. planned SP</h3>' + apChart + '</div>' +
      '<div class="card"><h3>Tickets completed (cumulative)</h3>' + completedChart + '</div>' +
      '</div>';
  }

  function renderTicketStatusBreakdown() {
    var el = document.getElementById('ticket-status-breakdown');
    var breakdown = computeTicketStatusBreakdown(getVisibleTickets());
    var colorByCategory = { new: 'var(--text-muted)', indeterminate: 'var(--series-1)', done: 'var(--status-good)' };
    el.innerHTML = buildStatusStackedBar(breakdown, colorByCategory);
  }

  function renderIssueTypeBreakdown() {
    var el = document.getElementById('issue-type-breakdown');
    var breakdown = computeIssueTypeBreakdown(getVisibleTickets());
    var rows = breakdown
      .map(function (b) {
        return (
          '<tr><td>' + escapeHtml(b.issue_type) + '</td><td>' + b.ticket_count + '</td><td>' +
          fmtNum(b.planned_sp) + '</td><td>' + fmtNum(b.delivered_ap) + '</td></tr>'
        );
      })
      .join('');
    el.innerHTML =
      '<table class="data-table"><thead><tr><th>Issue Type</th><th>Tickets</th><th>Planned SP</th><th>Delivered AP</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="empty-state">No tickets in the selected release(s).</td></tr>') +
      '</tbody></table>';
  }

  function renderEngineeringActivityTrend() {
    var el = document.getElementById('engineering-activity-trend');
    var trend = buildEngineeringActivityTrend(getVisibleTickets());
    el.innerHTML = buildLineChart(
      [
        { name: 'PRs opened', points: trend.pr_opened_by_day },
        { name: 'PRs merged', points: trend.pr_merged_by_day },
        { name: 'Tickets → In Progress', points: trend.tickets_in_progress_by_day },
        { name: 'Tickets completed', points: trend.tickets_completed_by_day },
      ],
      { ariaLabel: 'Engineering activity trend', height: 260 },
    );
  }

  function renderPrActivityTrend() {
    var el = document.getElementById('pr-activity-trend');
    var trend = buildPrActivityTrend(getVisibleTickets(), null, DATA.stale_pr_after_days);
    var chart = buildLineChart(
      [
        { name: 'PRs opened', points: trend.pr_opened_by_day },
        { name: 'PRs merged', points: trend.pr_merged_by_day },
      ],
      { ariaLabel: 'PR activity trend' },
    );

    var staleRows = trend.stale_prs
      .map(function (pr) {
        return (
          '<tr><td><a href="' + escapeHtml(pr.pr_url) + '" target="_blank" rel="noopener">' +
          escapeHtml(pr.repo.split('/')[1]) + ' #' + pr.pr_number + '</a></td><td>' +
          escapeHtml(pr.pr_title) + '</td><td>' + pr.days_open + '</td></tr>'
        );
      })
      .join('');

    var repoRows = trend.repo_breakdown
      .map(function (row) {
        var openNowCell = row.open_count
          ? '<td><button class="inline-btn repo-open-count" data-repo="' + escapeHtml(row.repo) + '">' + fmtNum(row.open_count) + '</button></td>'
          : '<td>' + fmtNum(row.open_count) + '</td>';
        return (
          '<tr><td>' + escapeHtml(row.repo) + '</td><td>' + fmtNum(row.opened_count) + '</td><td>' +
          fmtNum(row.merged_count) + '</td>' +
          openNowCell +
          '</tr>'
        );
      })
      .join('');

    var openPrDetailsHtml = '';
    if (state.selectedRepoOpenPrs && state.selectedRepoOpenPrs.length > 0) {
      openPrDetailsHtml =
        '<h3 class="subsection-title">Open PRs for ' + escapeHtml(state.selectedRepoName) + '</h3>' +
        '<table class="data-table"><thead><tr><th>PR</th><th>Title</th><th>Age</th></tr></thead><tbody>' +
        state.selectedRepoOpenPrs
          .map(function (pr) {
            return (
              '<tr><td><a href="' + escapeHtml(pr.pr_url) + '" target="_blank" rel="noopener">' +
              escapeHtml(pr.repo.split('/')[1]) + ' #' + pr.pr_number + '</a></td><td>' +
              escapeHtml(pr.pr_title) + '</td><td>' + fmtNum(pr.days_open) + 'd</td></tr>'
            );
          })
          .join('') +
        '</tbody></table>';
    }

    el.innerHTML =
      '<div class="kpi-row">' +
      kpiTile('Total PRs', fmtNum(trend.total_prs)) +
      kpiTile('Currently open', fmtNum(trend.currently_open_count)) +
      kpiTile('Avg. open PR age', trend.average_open_pr_age_days == null ? '—' : fmtNum(trend.average_open_pr_age_days, 1) + 'd') +
      kpiTile('Open > ' + trend.stale_pr_after_days + 'd', fmtNum(trend.stale_pr_count)) +
      '</div>' +
      chart +
      '<h3 class="subsection-title">Opened/merged PRs by repo</h3>' +
      '<table class="data-table"><thead><tr><th>Repository</th><th>Opened</th><th>Merged</th><th>Open now</th></tr></thead><tbody>' +
      (repoRows || '<tr><td colspan="4" class="empty-state">No PR evidence for the selected tickets.</td></tr>') +
      '</tbody></table>' +
      openPrDetailsHtml +
      (trend.stale_prs.length > 0
        ? '<h3 class="subsection-title">PRs open longer than ' + trend.stale_pr_after_days + ' days</h3>' +
          '<table class="data-table"><thead><tr><th>PR</th><th>Title</th><th>Days open</th></tr></thead><tbody>' +
          staleRows +
          '</tbody></table>'
        : '');

    Array.prototype.forEach.call(el.querySelectorAll('.repo-open-count'), function (button) {
      button.addEventListener('click', function () {
        var repo = button.getAttribute('data-repo');
        var selected = trend.repo_breakdown.find(function (row) { return row.repo === repo; });
        if (selected) {
          state.selectedRepoOpenPrs = selected.open_prs.map(function (pr) {
            return {
              pr_url: pr.pr_url,
              pr_title: pr.pr_title,
              pr_number: pr.pr_number,
              repo: pr.repo,
              days_open: Math.round((new Date().getTime() - new Date(pr.pr_created_at).getTime()) / (1000 * 60 * 60 * 24)),
            };
          });
          state.selectedRepoName = repo;
        } else {
          state.selectedRepoOpenPrs = [];
          state.selectedRepoName = '';
        }
        renderPrActivityTrend();
      });
    });
  }

  function renderCycleTime() {
    var el = document.getElementById('cycle-time');
    var dist = buildCycleTimeDistribution(getVisibleTickets());
    var agingRows = dist.aging_in_progress
      .map(function (t) {
        return (
          '<tr><td>' + escapeHtml(t.key) + '</td><td>' + escapeHtml(t.summary) + '</td><td>' +
          fmtNum(t.days_in_progress, 1) + '</td></tr>'
        );
      })
      .join('');

    el.innerHTML =
      '<p class="caveat">Time from a ticket’s first move into &quot;In Progress&quot; to its first move into &quot;Code Review&quot;. A ticket created directly into In Progress (skipping that transition) won’t have a value here.</p>' +
      '<div class="kpi-row">' +
      kpiTile('Median', dist.median_hours == null ? '—' : fmtNum(dist.median_hours / 24, 1) + 'd') +
      kpiTile('Mean', dist.mean_hours == null ? '—' : fmtNum(dist.mean_hours / 24, 1) + 'd') +
      kpiTile('Coverage', dist.coverage + ' / ' + dist.total_tickets + ' tickets') +
      '</div>' +
      buildHistogramBars(dist.histogram) +
      (dist.aging_in_progress.length > 0
        ? '<h3 class="subsection-title">Currently aging in In Progress</h3>' +
          '<table class="data-table"><thead><tr><th>Jira</th><th>Summary</th><th>Days in progress</th></tr></thead><tbody>' +
          agingRows +
          '</tbody></table>'
        : '');
  }

  function renderDeveloperDelivery() {
    var el = document.getElementById('developer-delivery');
    var rows = computeDeveloperDelivery(getVisibleTickets()).sort(function (a, b) {
      return b.delivered_ap - a.delivered_ap;
    });

    var body = rows
      .map(function (r) {
        return (
          '<tr class="dev-row" data-dev-id="' +
          escapeHtml(r.assignee_account_id) +
          '"><td>' +
          escapeHtml(r.assignee_display_name) +
          '</td><td>' +
          r.ticket_count +
          '</td><td>' +
          fmtNum(r.planned_sp) +
          '</td><td>' +
          fmtNum(r.delivered_ap) +
          '</td><td>' +
          (r.percent_of_highest_ap == null ? '—' : fmtPercent(r.percent_of_highest_ap)) +
          '</td><td>' +
          (r.percent_of_team_ap == null ? '—' : fmtPercent(r.percent_of_team_ap)) +
          '</td><td>' +
          (r.ai_contribution_percent == null
            ? '—'
            : fmtPercent(r.ai_contribution_percent) +
              ' <span class="coverage-note">(' +
              r.ai_contribution_coverage +
              '/' +
              r.ticket_count +
              ')</span>') +
          '</td></tr>'
        );
      })
      .join('');

    el.innerHTML =
      '<table class="data-table" id="developer-delivery-table"><thead><tr>' +
      '<th>Developer</th><th>Tickets</th><th>Planned SP</th><th>Delivered AP</th>' +
      '<th>% of Highest AP</th><th>% of Team AP</th><th>AI Contribution</th>' +
      '</tr></thead><tbody>' +
      (body || '<tr><td colspan="7" class="empty-state">No tickets in the selected release(s).</td></tr>') +
      '</tbody></table>';

    Array.prototype.forEach.call(el.querySelectorAll('.dev-row'), function (row) {
      row.addEventListener('click', function () {
        var devId = row.getAttribute('data-dev-id');
        state.selectedDeveloper = devId;
        state.ticketFilters.developer = devId;
        renderDeveloperDetails();
        renderAllTickets();
        var details = document.getElementById('developer-details');
        if (details.scrollIntoView) details.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderDeveloperDetails() {
    var el = document.getElementById('developer-details');
    if (!state.selectedDeveloper) {
      el.innerHTML = '<p class="empty-state">Click a developer in the table above to see their tickets.</p>';
      return;
    }

    var visible = getVisibleTickets();
    var tickets = visible.filter(function (t) { return t.assignee_account_id === state.selectedDeveloper; });
    if (tickets.length === 0) {
      el.innerHTML = '<p class="empty-state">No tickets found for this developer in the selected release(s).</p>';
      return;
    }

    var devRow = computeDeveloperDelivery(visible).find(function (r) {
      return r.assignee_account_id === state.selectedDeveloper;
    });

    var summaryHtml =
      '<div class="dev-summary-stats">' +
      statPair('Tickets', devRow.ticket_count) +
      statPair('Planned SP', fmtNum(devRow.planned_sp)) +
      statPair('Delivered AP', fmtNum(devRow.delivered_ap)) +
      statPair('% of Highest AP', devRow.percent_of_highest_ap == null ? '—' : fmtPercent(devRow.percent_of_highest_ap)) +
      statPair('% of Team AP', devRow.percent_of_team_ap == null ? '—' : fmtPercent(devRow.percent_of_team_ap)) +
      statPair('AI Contribution', devRow.ai_contribution_percent == null ? '—' : fmtPercent(devRow.ai_contribution_percent)) +
      '</div>';

    var ticketRows = tickets
      .map(function (t) {
        return (
          '<tr><td><a href="' +
          escapeHtml(t.jira_url) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(t.key) +
          '</a></td><td>' +
          escapeHtml(t.summary) +
          '</td><td>' +
          escapeHtml(t.status) +
          '</td><td>' +
          (t.sp == null ? '—' : t.sp) +
          '</td><td>' +
          (t.ap == null ? '—' : t.ap) +
          '</td><td>' +
          (t.ai_contribution_percent == null ? '—' : fmtPercent(t.ai_contribution_percent)) +
          '</td><td>' +
          prLinksHtml(t) +
          '</td></tr>'
        );
      })
      .join('');

    var timeline = buildDeveloperActivityTimeline(visible, state.selectedDeveloper);
    var timelineChart = buildLineChart(
      [
        { name: 'Tickets completed', points: timeline.tickets_completed_by_day },
        { name: 'PRs opened', points: timeline.pr_opened_by_day },
        { name: 'PRs merged', points: timeline.pr_merged_by_day },
      ],
      { ariaLabel: 'Developer activity timeline', height: 200 },
    );

    el.innerHTML =
      '<h3>' +
      escapeHtml(devRow.assignee_display_name) +
      '</h3>' +
      summaryHtml +
      '<h4 class="timeline-label">Activity over time (personal — not a comparison against anyone else)</h4>' +
      timelineChart +
      '<table class="data-table"><thead><tr><th>Jira</th><th>Summary</th><th>Status</th><th>SP</th><th>AP</th><th>AI Contribution</th><th>PR(s)</th></tr></thead><tbody>' +
      ticketRows +
      '</tbody></table>';
  }

  function uniqueValues(tickets, field) {
    var set = new Set();
    tickets.forEach(function (t) {
      if (t[field]) set.add(t[field]);
    });
    return Array.from(set).sort();
  }

  function uniqueDevelopers(tickets) {
    var map = new Map();
    tickets.forEach(function (t) {
      if (t.assignee_account_id) map.set(t.assignee_account_id, t.assignee_display_name);
    });
    return Array.from(map.entries()).sort(function (a, b) {
      return a[1].localeCompare(b[1]);
    });
  }

  function optionsHtml(values, current, allLabel) {
    var options =
      '<option value="">' +
      escapeHtml(allLabel) +
      '</option>' +
      values
        .map(function (v) {
          return '<option value="' + escapeHtml(v) + '"' + (v === current ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
        })
        .join('');
    return options;
  }

  function renderAllTickets() {
    var el = document.getElementById('all-tickets');
    var visible = getVisibleTickets();
    var statuses = uniqueValues(visible, 'status');
    var issueTypes = uniqueValues(visible, 'issue_type');
    var developers = uniqueDevelopers(visible);
    var tickets = getFilteredSortedTickets();

    var developerOptions =
      '<option value="">All developers</option>' +
      developers
        .map(function (pair) {
          return '<option value="' + escapeHtml(pair[0]) + '"' + (pair[0] === state.ticketFilters.developer ? ' selected' : '') + '>' + escapeHtml(pair[1]) + '</option>';
        })
        .join('');

    var filtersHtml =
      '<div class="ticket-filters">' +
      '<label class="filter-label">Status<select id="filter-status">' +
      optionsHtml(statuses, state.ticketFilters.status, 'All statuses') +
      '</select></label>' +
      '<label class="filter-label">Issue type<select id="filter-issue-type">' +
      optionsHtml(issueTypes, state.ticketFilters.issueType, 'All issue types') +
      '</select></label>' +
      '<label class="filter-label">Developer<select id="filter-developer">' +
      developerOptions +
      '</select></label>' +
      '</div>';

    function sortHeader(col, label) {
      var arrow = state.sortState.column === col ? (state.sortState.direction === 'asc' ? ' ▲' : ' ▼') : '';
      return '<th class="sortable" data-sort-col="' + col + '">' + escapeHtml(label) + arrow + '</th>';
    }

    var head =
      '<tr><th>Jira</th><th>Issue Type</th><th>Summary</th><th>Assignee</th><th>Status</th>' +
      sortHeader('sp', 'SP') +
      sortHeader('ap', 'AP') +
      sortHeader('ai_contribution_percent', 'AI Contribution') +
      '<th>PR(s)</th></tr>';

    var body = tickets
      .map(function (t) {
        return (
          '<tr>' +
          '<td><a href="' +
          escapeHtml(t.jira_url) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(t.key) +
          '</a></td>' +
          renderEditableCell(t, 'issue_type') +
          renderEditableCell(t, 'summary') +
          renderEditableCell(t, 'assignee') +
          renderEditableCell(t, 'status') +
          renderEditableCell(t, 'sp') +
          renderEditableCell(t, 'ap') +
          renderEditableCell(t, 'ai_contribution_percent') +
          '<td>' + prLinksHtml(t) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    el.innerHTML =
      filtersHtml +
      '<table class="data-table" id="all-tickets-table"><thead>' +
      head +
      '</thead><tbody>' +
      (body || '<tr><td colspan="9" class="empty-state">No tickets match the current filters.</td></tr>') +
      '</tbody></table>';

    el.querySelector('#filter-status').addEventListener('change', function (e) {
      state.ticketFilters.status = e.target.value;
      renderAllTickets();
    });
    el.querySelector('#filter-issue-type').addEventListener('change', function (e) {
      state.ticketFilters.issueType = e.target.value;
      renderAllTickets();
    });
    el.querySelector('#filter-developer').addEventListener('change', function (e) {
      state.ticketFilters.developer = e.target.value;
      state.selectedDeveloper = e.target.value || null;
      renderAllTickets();
      renderDeveloperDetails();
    });
    bindInlineTicketEditing(el);
    Array.prototype.forEach.call(el.querySelectorAll('th.sortable'), function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-sort-col');
        if (state.sortState.column === col) {
          state.sortState.direction = state.sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortState.column = col;
          state.sortState.direction = 'desc';
        }
        renderAllTickets();
      });
    });
  }

  function renderAll() {
    renderReleaseSummary();
    renderReleaseProgress();
    renderTicketStatusBreakdown();
    renderIssueTypeBreakdown();
    renderEngineeringActivityTrend();
    renderPrActivityTrend();
    renderCycleTime();
    renderDeveloperDelivery();
    renderDeveloperDetails();
    renderAllTickets();
  }

  renderReleasePicker();
  renderAll();
})();

function formatDisplayValue(field, ticket) {
  if (field === 'summary') return ticket.summary || '';
  if (field === 'status') return ticket.status || '';
  if (field === 'assignee') return ticket.assignee_account_id || '';
  if (field === 'issue_type') return ticket.issue_type || '';
  if (field === 'sp') return ticket.sp == null ? '' : ticket.sp;
  if (field === 'ap') return ticket.ap == null ? '' : ticket.ap;
  if (field === 'ai_contribution_percent') return ticket.ai_contribution_percent == null ? '' : ticket.ai_contribution_percent;
  return '';
}

export function buildInlineEditorConfig(field, ticket, options) {
  const value = formatDisplayValue(field, ticket);
  if (field === 'status') {
    return {
      type: 'select',
      value,
      options: options || [],
    };
  }

  return {
    type: 'input',
    value,
    options: [],
  };
}

export function normalizeInlineEditValue(field, value) {
  if (value === '' || value == null) {
    return field === 'sp' || field === 'ap' || field === 'ai_contribution_percent' ? null : '';
  }

  if (field === 'sp' || field === 'ap' || field === 'ai_contribution_percent') {
    const numericValue = Number(value);
    return Number.isNaN(numericValue) ? value : numericValue;
  }

  return value;
}

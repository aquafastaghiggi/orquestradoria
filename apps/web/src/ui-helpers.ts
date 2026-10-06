export const statusLabels: Record<string, string> = {
  pending: 'Pendente', analyzing: 'Analisando', planning: 'Planejando', implementing: 'Implementando',
  testing: 'Testando', reviewing: 'Revisando', completed: 'Concluída', approved: 'Aprovada',
  needs_fix: 'Precisa de ajuste', failed: 'Falhou', cancelled: 'Cancelada', stalled: 'Parada',
  running: 'Em execução', approved_waiting_action: 'Aprovada · aguardando sua ação',
  failed_preserved: 'Falhou · ambiente preservado', manual_review_preserved: 'Revisão manual necessária',
  apply_conflict: 'Conflito ao aplicar', preparation_failed: 'Preparação bloqueada', applied: 'Aplicada', discarded: 'Descartada',
};

const errorLabels: Record<string, string> = {
  apply_blocked_dirty_workspace: 'A branch base possui alterações locais não commitadas. Resolva-as antes de aplicar esta task.',
  base_branch_advanced: 'A branch base mudou desde o início da task. Revise as alterações antes de aplicar.',
  apply_conflict: 'O Git encontrou conflitos ao integrar esta task.',
  repository_has_no_commits: 'O repositório ainda não possui um commit inicial. Crie um baseline commit e tente novamente.',
  base_branch_missing: 'A branch base configurada não existe neste repositório.',
  worktree_create_failed: 'Não foi possível criar o worktree isolado.',
  worktree_path_conflict: 'O caminho do worktree já está sendo usado por outra task.',
  git_unavailable: 'O Git não está disponível neste ambiente.',
  configuration_error: 'A configuração da execução é inválida.',
  provider_error: 'O provider encontrou um erro durante a execução.',
  timeout: 'A execução excedeu o tempo limite.',
  stalled: 'A execução parou de emitir atividade.',
};

export function humanizeStatus(status?: string) {
  if (!status) return '—';
  return statusLabels[status] || status.replaceAll('_', ' ');
}

export function humanizeErrorCode(code?: string, fallback?: string) {
  return (code && errorLabels[code]) || fallback || 'Ocorreu um erro ao processar a solicitação.';
}

export function humanizeWarning(warning?: string, code?: string) {
  if (!warning && !code) return '';
  if (code === 'base_branch_missing' || /configured branch .* was not found; using/i.test(warning || '')) {
    const match = warning?.match(/configured branch ['"]?([^'"]+)['"]? was not found; using ['"]?([^'".]+)['"]?/i);
    return match
      ? `A branch configurada '${match[1]}' não foi encontrada. Utilizando '${match[2]}'.`
      : 'A branch configurada não foi encontrada. Utilizando a branch efetiva do repositório.';
  }
  if (/main workspace has uncommitted changes/i.test(warning || '')) return 'O workspace principal possui alterações locais não commitadas.';
  if (/git isolation unavailable/i.test(warning || '')) return 'O isolamento Git não está disponível para este workspace.';
  if (/repository has no initial commit/i.test(warning || '')) return 'O repositório ainda não possui um commit inicial.';
  return warning || 'Há um aviso operacional nesta task.';
}

export function humanizeEventType(type?: string) {
  const labels: Record<string, string> = {
    'task.created': 'Task criada', 'task.started': 'Task iniciada', 'task.resumed': 'Task retomada',
    'task.completed': 'Task concluída', 'task.cancelled': 'Task cancelada', 'execution.started': 'Execução iniciada',
    'execution.progress': 'Progresso da execução', 'execution.heartbeat': 'Heartbeat do provider',
    'execution.completed': 'Execução concluída', 'execution.failed': 'Execução falhou',
    'execution.stalled': 'Execução parada', 'budget.exceeded': 'Orçamento excedido',
  };
  return labels[type || ''] || type || 'Evento';
}

export function providerLabel(provider?: string) {
  if (provider === 'claude-code') return 'Claude Code';
  if (provider === 'codex-cli') return 'Codex CLI';
  if (provider === 'command-tester') return 'Command Tester';
  if (provider === 'openai-compatible') return 'OpenAI-compatible';
  if (provider === 'anthropic') return 'Anthropic API';
  return provider || 'Mock';
}

export function shortTaskDescription(task: { description?: string; summary?: string; objective?: string; structuredResult?: any }) {
  const raw = [task.summary, task.objective, task.structuredResult?.summary, task.structuredResult?.objective, task.description]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) || 'Sem descrição disponível.';
  const section = (text: string, name: 'Summary' | 'Objective') =>
    text.match(new RegExp(`(?:^|\\n)\\s*#{1,6}\\s*${name}\\b\\s*:?[ \\t]*([\\s\\S]*?)(?=\\n\\s*#{1,6}\\s+|$)`, 'im'))?.[1]?.trim() || '';
  const structured = section(raw, 'Summary') || section(raw, 'Objective') || raw;
  return structured.replace(/^#{1,6}\s*/gm, '').replace(/[\\*_~`]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 180).trimEnd();
}

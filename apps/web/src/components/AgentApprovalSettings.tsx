import { useEffect, useState } from 'react';
import { RUNTIME_CAPABILITY_MATRIX, type AgentApprovalMode } from '@openpixo/contracts';
import { useT } from '../i18n';
import { fetchAgentCapabilities } from '../providers/agent-capabilities';
import { ApprovalModePicker } from './composer/ApprovalModePicker';

export function AgentApprovalSettings({ agentId, mode = 'in-app', onChange }: {
  agentId: string | null;
  mode?: AgentApprovalMode;
  onChange(mode: AgentApprovalMode): void;
}) {
  const t = useT();
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    let active = true;
    setUnsupported(false);
    void fetchAgentCapabilities().then((data) => {
      if (active) setUnsupported(data.matrix[agentId ?? '']?.approvals.state === 'unsupported');
    }).catch(() => {});
    return () => { active = false; };
  }, [agentId]);
  const known = RUNTIME_CAPABILITY_MATRIX[agentId as keyof typeof RUNTIME_CAPABILITY_MATRIX];
  if (unsupported || known?.approvals.state === 'unsupported') return <p className="hint">{t('settings.approvalMode.unsupported')}</p>;
  if (!agentId) return null;
  return (
    <ApprovalModePicker agentId={agentId} mode={mode} onChange={onChange} variant="settings" />
  );
}

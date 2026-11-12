// @vitest-environment jsdom
// Product decision 2026-09-15 / OPEND-2807: fixed card actions replace every
// previous ladder action. Real ChatPane, AssistantMessage and RunErrorCard;
// only the unrelated composer is replaced. No classifier or card mocks.
import { cleanup, render, screen } from '@testing-library/react';
import {forwardRef,type ComponentProps} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ChatPane} from '../../src/components/ChatPane';
import {zhCN} from '../../src/i18n/locales/zh-CN';
import type {AgentEvent,AppConfig,ChatMessage} from '../../src/types';

const translate=(key:string,vars?:Record<string,string|number>)=>{
 const text=zhCN[key as keyof typeof zhCN]??key;
 return text.replace(/\{(\w+)\}/g,(_,name:string)=>vars?.[name]===undefined?`{${name}}`:String(vars[name]));
};
vi.mock('../../src/i18n',()=>({useI18n:()=>({locale:'zh-CN',setLocale:()=>undefined,t:translate}),useT:()=>translate}));
vi.mock('../../src/components/ChatComposer',()=>({ChatComposer:forwardRef((_props,_ref)=><div data-testid="composer"/>)}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

type StatusEvent=Extract<AgentEvent,{kind:'status'}>;
function errorEvent(overrides:Partial<StatusEvent>={}):StatusEvent{
 return {kind:'status',label:'error',code:'AGENT_EXECUTION_FAILED',detail:'controlled diagnostic retained for export',failureDetail:'process_crashed',...overrides};
}

function failedTurn(agentId:string,event:StatusEvent,resumable=false):ChatMessage{
 return {id:'failed-assistant',role:'assistant',content:'',createdAt:1000,endedAt:2000,runId:'failed-run',runStatus:'failed',agentId,resumable,events:[event]};
}
function renderPane(message:ChatMessage,extra:Partial<ComponentProps<typeof ChatPane>>={}){
 const onRetry=vi.fn(),onSwitchToAmrAndRetry=vi.fn();
 const actions={onRetry,onResumeRun:vi.fn(),onSwitchModel:vi.fn(),onOpenSettings:vi.fn(),onSwitchToLocalCli:vi.fn(),onLaunchAntigravityOauth:vi.fn().mockResolvedValue(undefined)};
 render(<ChatPane messages={[{id:'user-1',role:'user',content:'Create the requested page',createdAt:0},message]}
  streaming={false} error={null} projectId="project-2807" projectFiles={[]}
  onEnsureProject={async()=>'project-2807'} onSend={vi.fn()} onStop={vi.fn()}
  conversations={[{projectId:'project-2807',id:'conversation-1',title:'Current',createdAt:0,updatedAt:0}]}
  activeConversationId="conversation-1" onSelectConversation={vi.fn()} onDeleteConversation={vi.fn()}
  config={{mode:'daemon',agentId:message.agentId,agentCliEnv:{}} as AppConfig}
  showByokRecoveryAction {...actions} {...extra}/>);
 return actions;
}

describe('OPEND-2807 fixed actions override the old recovery ladder',()=>{
 
 
 
 it('does not revive the Git Bash card or erase the real failed history',()=>{
  const message=failedTurn('claude',errorEvent({failureDetail:'git_bash_missing',retryable:false,detail:'Claude Code on Windows requires git-bash.'}));
  const before=structuredClone(message);renderPane(message);
  expect(screen.queryByTestId('chat-run-error-card')).toBeNull();
  expect(screen.getByTestId('assistant-role')).toBeTruthy();expect(screen.getByText('运行失败')).toBeTruthy();
  expect(message).toEqual(before);
 });
});

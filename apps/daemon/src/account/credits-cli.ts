import { formatAgentCredits, formatCostMultiplier, hostedModelCostMultipliers, OPENPIXO_AGENT_DEFAULT_MODEL, PRODUCT_CLI_NAME, type CreateOpenPixoCheckoutResponse, type OpenPixoAgentCatalogResponse,
  type OpenPixoAgentRunUsageResponse, type OpenPixoBillingPortalResponse, type OpenPixoCatalogResponse, type OpenPixoCreditsSummary,
  type OpenPixoLedgerResponse, type OpenPixoPlanChangeQuote, type OpenPixoPlanChangeResponse } from '@openpixo/contracts';
import { parseArgs } from 'node:util';
import { accountCliApi, AccountCliError, openAccountBrowser, printAccountCliError } from './cli-common.js';

const USAGE = `${PRODUCT_CLI_NAME} credits balance [--json]
${PRODUCT_CLI_NAME} credits history [--limit 1..100] [--cursor <cursor>] [--json]
${PRODUCT_CLI_NAME} credits catalog [--json]
${PRODUCT_CLI_NAME} credits buy <sku> [--no-browser] [--json]
${PRODUCT_CLI_NAME} credits portal [--no-browser] [--json]
${PRODUCT_CLI_NAME} credits plan [--json]
${PRODUCT_CLI_NAME} credits change-plan <sku> [--yes] [--no-browser] [--json]
${PRODUCT_CLI_NAME} credits undo-plan-change [--json]
${PRODUCT_CLI_NAME} credits agent-models [--json]
${PRODUCT_CLI_NAME} credits agent-usage <runId> [--json]
All commands accept --daemon-url <url>. Catalog and agent-models are available without signing in.
Run the agent on credits with: ${PRODUCT_CLI_NAME} run start --agent openpixo-agent [--model openpixo-agent-flash] [--reasoning low|medium|high] …
Credits arrive after payment is confirmed / 支付确认后积分到账。
change-plan shows the price first. An upgrade charges the saved card the difference between the plans as soon as --yes is given and takes effect now; a downgrade waits for the next renewal. Unused plan credits end at each renewal.
change-plan 先显示价格。加 --yes 后，升级立即用已保存的银行卡扣两档差价并生效；降级在下次续费时生效。未用完的套餐积分在每次续费时清零。`;

function price(amountMinor: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase() });
  return formatter.format(amountMinor / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}

export function ledgerKindLabel(kind: string): string {
  return kind === 'multiplayer' ? 'Live rooms / 联机房间' : kind;
}

export async function runCreditsCli(args: string[]): Promise<void> {
  const json = args.includes('--json');
  try {
    if (!args.length || args[0] === 'help' || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const command = args[0];
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, 'daemon-url': { type: 'string' }, 'no-browser': { type: 'boolean' },
      limit: { type: 'string' }, cursor: { type: 'string' }, yes: { type: 'boolean' },
    } });
    if (!['balance', 'history', 'catalog', 'buy', 'portal', 'plan', 'change-plan', 'undo-plan-change', 'agent-models', 'agent-usage'].includes(command!)
      || positionals.length !== (command === 'buy' || command === 'agent-usage' || command === 'change-plan' ? 1 : 0)
      || (command !== 'history' && (values.limit !== undefined || values.cursor !== undefined))
      || (values.yes && command !== 'change-plan')
      || (values['no-browser'] && command !== 'buy' && command !== 'portal' && command !== 'change-plan')) throw new AccountCliError('BAD_REQUEST', USAGE);
    const api = await accountCliApi(values['daemon-url']);
    if (command === 'balance') {
      const result = await api<OpenPixoCreditsSummary>('/credits');
      if (json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Available / 可用: ${result.available}\nReserved / 预占: ${result.reserved}`);
    } else if (command === 'history') {
      const limit = values.limit ?? '20';
      if (!/^\d{1,3}$/u.test(limit) || Number(limit) < 1 || Number(limit) > 100) throw new AccountCliError('BAD_REQUEST', '--limit must be an integer from 1 to 100.');
      const query = new URLSearchParams({ limit });
      if (values.cursor !== undefined) query.set('cursor', values.cursor);
      const result = await api<OpenPixoLedgerResponse>(`/credits/ledger?${query}`);
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        for (const entry of result.entries) console.log(`${entry.createdAt}  ${ledgerKindLabel(entry.kind)}  ${entry.amount > 0 ? '+' : ''}${entry.amount}  ${entry.balanceAfter}`);
        if (!result.entries.length) console.log('No credit history / 暂无积分记录。');
        if (result.nextCursor) console.log(`Next / 下一页: --cursor ${result.nextCursor}`);
      }
    } else if (command === 'catalog') {
      const result = await api<OpenPixoCatalogResponse>('/credits/catalog');
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        for (const item of result.topups) console.log(`${item.sku}  ${item.credits} credits / 积分  ${price(item.amountMinor, item.currency)}`);
        for (const item of result.plans) console.log(`${item.sku}  ${item.monthlyCredits} credits/month / 积分每月  ${price(item.amountMinor, item.currency)}`);
        if (result.purchasesPaused) console.log('Purchases paused / 购买已暂停。');
      }
    } else if (command === 'agent-models') {
      const result = await api<OpenPixoAgentCatalogResponse>('/agent/models');
      // Same estimate as the model picker: a typical coding turn, relative to the default model.
      const multipliers = hostedModelCostMultipliers(result.models);
      if (json) {
        console.log(JSON.stringify({ ...result, costBaselineModel: OPENPIXO_AGENT_DEFAULT_MODEL, models: result.models.map((model) => {
          const multiplier = multipliers.get(model.id);
          return { ...model, costMultiplier: multiplier === undefined ? null : Math.round(multiplier * 100) / 100 };
        }) }, null, 2));
      } else {
        for (const model of result.models) {
          const rate = model.creditsPerMillionTokens;
          const multiplier = multipliers.get(model.id);
          const cost = multiplier === undefined ? '' : `  ${formatCostMultiplier(multiplier)}`;
          console.log(`${model.id}  ${model.label}${cost}
  credits per 1M tokens / 每百万 token 积分: input ${rate.inputCacheMiss}, cached input ${rate.inputCacheHit}${rate.inputCacheWrite === undefined ? '' : `, cache write ${rate.inputCacheWrite}`}, output ${rate.output}
  effort / 强度: ${model.reasoningEfforts.length ? model.reasoningEfforts.join(', ') : 'none'}${model.defaultReasoningEffort ? ` (default ${model.defaultReasoningEffort})` : ''}`);
        }
        if (multipliers.size) console.log('× = estimated use on a typical coding task, relative to DeepSeek V4.1 Flash / 按一般编程任务估算的消耗，相对 DeepSeek V4.1 Flash');
        if (result.agentPaused) console.log('The OpenPixo agent is paused / OpenPixo 智能体已暂停。');
        if (!result.signedIn) console.log('Sign in to use it / 登录后可用: pixo account login');
      }
    } else if (command === 'agent-usage') {
      const result = await api<OpenPixoAgentRunUsageResponse>(`/agent/runs/${encodeURIComponent(positionals[0]!)}/usage`);
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        const usage = result.cloud ?? result.local;
        console.log(`Credits used / 已用积分: ${formatAgentCredits(usage.costMicrocredits)} (${usage.requests} requests / 次请求)`);
        console.log(`Tokens: input ${usage.inputTokens} (cached ${usage.cachedInputTokens}), output ${usage.outputTokens}`);
        if (!result.cloud) console.log('Cloud totals unavailable; showing what this daemon relayed / 云端总计不可用，显示本机转发的用量。');
      }
    } else if (command === 'buy') {
      const result = await api<CreateOpenPixoCheckoutResponse>('/credits/checkout', 'POST', { sku: positionals[0] });
      console.log(json ? JSON.stringify(result, null, 2) : result.checkoutUrl);
      console.error('Credits arrive after payment is confirmed / 支付确认后积分到账。');
      await openAccountBrowser(result.checkoutUrl, values['no-browser']);
    } else if (command === 'plan') {
      const result = await api<OpenPixoCreditsSummary>('/credits');
      if (json) console.log(JSON.stringify({ subscription: result.subscription, available: result.available }, null, 2));
      else console.log(describePlan(result));
    } else if (command === 'change-plan') {
      const sku = positionals[0]!;
      const quote = await api<OpenPixoPlanChangeQuote>('/credits/plan-change/preview', 'POST', { sku });
      if (!values.yes) {
        if (json) console.log(JSON.stringify(quote, null, 2));
        else console.log(`${describeQuote(quote)}\nRun again with --yes to confirm / 确认请加 --yes。`);
        return;
      }
      const result = await api<OpenPixoPlanChangeResponse>('/credits/plan-change', 'POST', { sku, expectedChargeMinor: quote.chargeNowMinor });
      if (json) console.log(JSON.stringify(result, null, 2));
      else console.log(describeOutcome(result));
      if (result.paymentUrl) await openAccountBrowser(result.paymentUrl, values['no-browser']);
      if (result.outcome === 'payment_failed') process.exitCode = 5;
    } else if (command === 'undo-plan-change') {
      const result = await api<OpenPixoPlanChangeResponse>('/credits/plan-change/cancel', 'POST');
      if (json) console.log(JSON.stringify(result, null, 2));
      else console.log(describeOutcome(result));
    } else {
      const result = await api<OpenPixoBillingPortalResponse>('/credits/portal', 'POST');
      console.log(json ? JSON.stringify(result, null, 2) : result.url);
      await openAccountBrowser(result.url, values['no-browser']);
    }
  } catch (error) { printAccountCliError(error, json); }
}

function describePlan(summary: OpenPixoCreditsSummary): string {
  const plan = summary.subscription;
  if (!plan) return `No plan / 没有套餐. Available / 可用: ${summary.available}`;
  const lines = [`Plan / 套餐: ${plan.sku} (${plan.status})`, `Available / 可用: ${summary.available}`,
    `${plan.cancelAtPeriodEnd ? 'Ends / 结束于' : 'Renews / 续费于'}: ${plan.currentPeriodEnd}`];
  if (summary.planCredits) lines.push(`Plan credits ending then / 届时清零的套餐积分: ${summary.planCredits}`);
  if (plan.pendingDowngrade) lines.push(`Changes to / 将改为 ${plan.pendingDowngrade.sku} on / 于 ${plan.pendingDowngrade.effectiveAt}`);
  if (plan.pendingUpgrade) lines.push(`Upgrade to ${plan.pendingUpgrade.sku} waits for verification / 升级等待验证付款: ${plan.pendingUpgrade.paymentUrl}`);
  return lines.join('\n');
}

function describeQuote(quote: OpenPixoPlanChangeQuote): string {
  if (quote.kind === 'undo_downgrade') return `Keep ${quote.fromSku}, cancel the pending downgrade / 保留当前套餐，撤销降级. Nothing is charged / 不扣款。`;
  const next = `Then / 之后: ${price(quote.nextChargeMinor, quote.currency)} and / 和 ${quote.nextMonthlyCredits} credits each month from / 每月，自 ${quote.nextRenewalAt}`;
  if (quote.kind === 'upgrade') {
    return `Upgrade ${quote.fromSku} to ${quote.toSku}, effective now / 立即生效\nCharged now / 现在扣款: ${price(quote.chargeNowMinor, quote.currency)}\nCredits now / 立即到账: +${quote.creditsNow}\n${next}`;
  }
  return `Downgrade ${quote.fromSku} to ${quote.toSku} on / 降级生效于 ${quote.effectiveAt}\nCharged now / 现在扣款: nothing / 不扣款\nYou keep your plan and credits until then / 在此之前套餐和积分不变\n${next}`;
}

function describeOutcome(result: OpenPixoPlanChangeResponse): string {
  const balance = `Available / 可用: ${result.credits.available}`;
  switch (result.outcome) {
    case 'upgraded': return `Upgraded to ${result.credits.subscription?.sku} / 升级成功\n${balance}`;
    case 'downgrade_scheduled': return `Downgrade scheduled / 降级已安排: ${result.credits.subscription?.pendingDowngrade?.effectiveAt}\n${balance}`;
    case 'downgrade_canceled': return `Downgrade undone / 已撤销降级\n${balance}`;
    case 'payment_failed': return `The card was declined${result.declineCode ? ` (${result.declineCode})` : ''}. Nothing changed / 扣款失败，套餐和积分都没有变化。`;
    case 'payment_requires_action': return `Your bank wants to verify this payment / 银行需要验证这笔付款: ${result.paymentUrl}`;
    case 'payment_processing': return `The payment is still processing / 付款还在处理中。Check again with / 稍后查看: ${PRODUCT_CLI_NAME} credits plan`;
    default: return `Nothing is pending now / 没有待处理的变更。\n${balance}`;
  }
}

import { PRODUCT_CLI_NAME, type GoogleSignInAttemptResponse, type OpenPixoAccountStatus,
  type StartEmailSignInResponse, type StartGoogleSignInResponse } from '@openpixo/contracts';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { accountCliApi, AccountCliError, openAccountBrowser, printAccountCliError, promptEmailCode } from './cli-common.js';

const USAGE = `${PRODUCT_CLI_NAME} account status [--json]
${PRODUCT_CLI_NAME} account login --email <address> [--json]
${PRODUCT_CLI_NAME} account login --google [--no-browser] [--json]
${PRODUCT_CLI_NAME} account logout [--json]
All commands accept --daemon-url <url>. Email codes are read privately from interactive stdin, never argv.
Google sign-in prints the URL and waits up to 10 minutes. --no-browser skips opening it.
邮箱验证码通过交互终端输入；Google 登录在系统浏览器中完成。`;

export async function runAccountCli(args: string[]): Promise<void> {
  const json = args.includes('--json');
  try {
    if (!args.length || args[0] === 'help' || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
    const command = args[0];
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, options: {
      json: { type: 'boolean' }, 'daemon-url': { type: 'string' }, email: { type: 'string' },
      google: { type: 'boolean' }, 'no-browser': { type: 'boolean' },
    } });
    if (positionals.length || !['status', 'login', 'logout'].includes(command!)) throw new AccountCliError('BAD_REQUEST', USAGE);
    if (command !== 'login' && (values.email !== undefined || values.google || values['no-browser'])) throw new AccountCliError('BAD_REQUEST', USAGE);
    if (command === 'login' && ((values.email !== undefined) === (values.google === true)
      || (values.email !== undefined && values['no-browser']))) throw new AccountCliError('BAD_REQUEST', USAGE);
    if (command === 'login' && values.email !== undefined && !process.stdin.isTTY) {
      throw new AccountCliError('BAD_REQUEST', 'Email sign-in requires an interactive terminal for the code.');
    }
    const api = await accountCliApi(values['daemon-url']);
    let account: OpenPixoAccountStatus;
    if (command === 'status') account = await api('/account');
    else if (command === 'logout') account = await api('/account/sign-out', 'POST');
    else if (values.email !== undefined) {
      await api<StartEmailSignInResponse>('/account/email/start', 'POST', { email: values.email });
      console.error('A code was sent to your email / 验证码已发送，请查收邮件。');
      account = await api('/account/email/verify', 'POST', { email: values.email, code: await promptEmailCode() });
    } else {
      const start = await api<StartGoogleSignInResponse>('/account/google/start', 'POST');
      if (json) console.error(start.authorizeUrl); else console.log(start.authorizeUrl);
      await openAccountBrowser(start.authorizeUrl, values['no-browser']);
      const deadline = Date.parse(start.expiresAt);
      while (true) {
        const attempt = await api<GoogleSignInAttemptResponse>(`/account/google/attempts/${encodeURIComponent(start.attemptId)}`);
        if (attempt.state === 'completed' && attempt.account) { account = attempt.account; break; }
        if (attempt.state === 'failed') throw new AccountCliError(attempt.error ?? 'ACCOUNT_LOGIN_FAILED', 'Google sign-in failed. Please try again.');
        if (attempt.state === 'expired' || !Number.isFinite(deadline) || Date.now() >= deadline) {
          throw new AccountCliError('ACCOUNT_LOGIN_EXPIRED', 'Google sign-in expired. Start sign-in again.');
        }
        await delay(Math.min(1000, Math.max(1, deadline - Date.now())));
      }
    }
    if (json) console.log(JSON.stringify(account, null, 2));
    else if (account.availability === 'not_configured') console.log('OpenPixo cloud is not configured / 云端未配置。');
    else if (account.availability === 'secure_storage_unavailable') console.log('Secure account storage is unavailable / 安全存储不可用。');
    else console.log(account.signedIn ? `Signed in / 已登录: ${account.user?.email}` : 'Signed out / 未登录。');
  } catch (error) { printAccountCliError(error, json); }
}

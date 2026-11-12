import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@openpixo/components';
import type {
  ProjectExtensionKind,
  ProjectExtensionSummary,
  ProjectExtensionsResponse,
} from '@openpixo/contracts';
import { tForLanguageTag } from '../i18n';
import styles from './ProjectExtensionsPanel.module.css';

// OpenPixo's project workflow ships in English and Chinese independently of
// the upstream marketplace's broader locale catalogue.
const COPY = {
  en: {
    title: 'Project extensions',
    scope: 'Enabled extensions apply to this project. Removing an extension keeps project files.',
    refresh: 'Refresh',
    loading: 'Loading extensions…',
    skills: 'Skills',
    mcp: 'MCP servers',
    empty: 'No extensions added.',
    defaults: 'Built-in skills',
    defaultsHint: 'The agent uses these on its own when a task calls for them. You can turn them off in Settings.',
    enabled: 'Enabled',
    disabled: 'Disabled',
    unavailable: 'Unavailable',
    enable: 'Enable',
    disable: 'Disable',
    update: 'Update',
    remove: 'Remove',
    version: 'Version',
    source: 'Source',
    catalog: 'Add from catalog',
    select: 'Choose an extension',
    add: 'Add to project',
    templates: 'MCP templates',
    configure: 'Configure template',
    requiredConfiguration: 'Required configuration',
    homepage: 'Server documentation',
    importTitle: 'Import an extension',
    kind: 'Type',
    skill: 'Skill',
    location: 'Local path or GitHub URL',
    locationHint: 'Skill folder, MCP JSON file, or a public GitHub source',
    config: 'MCP server JSON (optional)',
    configHint: 'Paste one server configuration, or use a source path above.',
    import: 'Import to project',
    invalidJson: 'Enter a JSON object for the MCP server.',
    sourceRequired: 'Enter a source path or URL.',
    failed: 'Could not load project extensions.',
    saving: 'Saving…',
  },
  zh: {
    title: '项目扩展',
    scope: '启用的扩展仅应用于此项目。移除扩展会保留项目文件。',
    refresh: '刷新',
    loading: '正在加载扩展…',
    skills: 'Skills',
    mcp: 'MCP 服务器',
    empty: '尚未添加扩展。',
    defaults: '内置技能',
    defaultsHint: 'AI 做相关任务时会自动使用，不用手动添加。可以在设置里关闭。',
    enabled: '已启用',
    disabled: '已停用',
    unavailable: '不可用',
    enable: '启用',
    disable: '停用',
    update: '更新',
    remove: '移除',
    version: '版本',
    source: '来源',
    catalog: '从目录添加',
    select: '选择扩展',
    add: '添加到项目',
    templates: 'MCP 模板',
    configure: '配置模板',
    requiredConfiguration: '必填配置',
    homepage: '服务器文档',
    importTitle: '导入扩展',
    kind: '类型',
    skill: 'Skill',
    location: '本地路径或 GitHub 地址',
    locationHint: 'Skill 文件夹、MCP JSON 文件或公开 GitHub 来源',
    config: 'MCP 服务器 JSON（可选）',
    configHint: '粘贴单个服务器配置，或填写上方来源路径。',
    import: '导入到项目',
    invalidJson: '请输入 MCP 服务器的 JSON 对象。',
    sourceRequired: '请输入来源路径或地址。',
    failed: '无法加载项目扩展。',
    saving: '正在保存…',
  },
} as const;

type Labels = typeof COPY.en | typeof COPY.zh;
type Translate = NonNullable<ReturnType<typeof tForLanguageTag>>;

function safeHomepage(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

function failureMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as { message?: unknown; error?: unknown };
  if (typeof value.error === 'string') return value.error;
  if (value.error && typeof value.error === 'object' && 'message' in value.error
    && typeof value.error.message === 'string') return value.error.message;
  return typeof value.message === 'string' ? value.message : fallback;
}

async function requestExtensions(
  url: string,
  fallback: string,
  init: RequestInit = {},
): Promise<ProjectExtensionsResponse> {
  const response = await fetch(url, init);
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(failureMessage(payload, `${fallback} (HTTP ${response.status})`));
  return payload as ProjectExtensionsResponse;
}

function ExtensionList({
  kind,
  rows,
  labels,
  translate,
  locale,
  pending,
  onAction,
}: {
  kind: ProjectExtensionKind;
  rows: ProjectExtensionSummary[];
  labels: Labels;
  translate: Translate;
  locale: string;
  pending: boolean;
  onAction: (kind: ProjectExtensionKind, id: string, action: 'enable' | 'disable' | 'update' | 'remove') => void;
}) {
  const title = kind === 'skill' ? labels.skills : labels.mcp;
  return (
    <section className={styles.section} aria-label={title}>
      <h3>{title}</h3>
      {kind === 'skill' && rows.some(row => row.enabled && row.contextCost) && <p className={styles.muted}>{translate('extensions.skillCost.hint')}</p>}
      {rows.length === 0 ? <p className={styles.muted}>{labels.empty}</p> : (
        <ul className={styles.list}>
          {rows.map((extension) => (
            <li key={extension.id} className={styles.extension}>
              <div className={styles.row}>
                <strong>{extension.name}</strong>
                <span className={styles.status}>
                  {!extension.available ? labels.unavailable : extension.enabled ? labels.enabled : labels.disabled}
                </span>
              </div>
              {extension.description && <p>{extension.description}</p>}
              <dl className={styles.metadata}>
                <div><dt>{labels.version}</dt><dd><code>{extension.version}</code></dd></div>
                <div><dt>{labels.source}</dt><dd><code>{extension.source}</code></dd></div>
                {kind === 'skill' && extension.enabled && extension.contextCost && <>
                  <div><dt>{translate('extensions.skillCost.index')}</dt><dd>{translate('extensions.skillCost.value', {
                    tokens: extension.contextCost.indexTokens.toLocaleString(locale),
                    bytes: extension.contextCost.indexBytes.toLocaleString(locale),
                  })}</dd></div>
                  <div><dt>{translate('extensions.skillCost.onDemand')}</dt><dd>{translate('extensions.skillCost.value', {
                    tokens: extension.contextCost.onDemandTokens.toLocaleString(locale),
                    bytes: extension.contextCost.onDemandBytes.toLocaleString(locale),
                  })}</dd></div>
                </>}
              </dl>
              {extension.dependency && (
                <p className={styles.dependency} role={extension.dependency.status === 'missing' ? 'status' : undefined}>
                  {extension.dependency.message}
                </p>
              )}
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || (!extension.available && !extension.enabled)}
                  aria-label={`${extension.enabled ? labels.disable : labels.enable} ${extension.name}`}
                  aria-pressed={extension.enabled}
                  onClick={() => onAction(kind, extension.id, extension.enabled ? 'disable' : 'enable')}
                >
                  {extension.enabled ? labels.disable : labels.enable}
                </Button>
                {extension.source !== 'inline' && (
                  <Button size="sm" variant="secondary" disabled={pending}
                    aria-label={`${labels.update} ${extension.name}`}
                    onClick={() => onAction(kind, extension.id, 'update')}>
                    {labels.update}
                  </Button>
                )}
                <Button size="sm" variant="subtle" disabled={pending}
                  aria-label={`${labels.remove} ${extension.name}`}
                  onClick={() => onAction(kind, extension.id, 'remove')}>
                  {labels.remove}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** `embedded`: the host (the panel's 项目扩展 sheet) already shows the title. */
function ExtensionManager({ projectId, locale, embedded }: { projectId: string; locale: string; embedded?: boolean }) {
  const isChinese = locale.toLowerCase().startsWith('zh');
  const labels = isChinese ? COPY.zh : COPY.en;
  const translate = tForLanguageTag(locale) ?? tForLanguageTag('en')!;
  const formId = useId();
  const revision = useRef(0);
  const [data, setData] = useState<ProjectExtensionsResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<ProjectExtensionKind>('skill');
  const [catalogId, setCatalogId] = useState('');
  const [source, setSource] = useState('');
  const [serverJson, setServerJson] = useState('');
  const baseUrl = `/api/projects/${encodeURIComponent(projectId)}/extensions`;

  async function load() {
    const current = ++revision.current;
    setPending(true);
    setError('');
    try {
      const result = await requestExtensions(baseUrl, labels.failed);
      if (current === revision.current) setData(result);
    } catch (cause) {
      if (current === revision.current) setError(isChinese ? labels.failed : cause instanceof Error ? cause.message : labels.failed);
    } finally {
      if (current === revision.current) setPending(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { revision.current += 1; };
    // The keyed manager owns exactly one project; language changes only copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  async function mutate(path: string, method: 'POST' | 'DELETE', body?: unknown) {
    const current = ++revision.current;
    setPending(true);
    setError('');
    try {
      const result = await requestExtensions(`${baseUrl}${path}`, labels.failed, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (current === revision.current) setData(result);
      return current === revision.current;
    } catch (cause) {
      if (current === revision.current) setError(isChinese ? labels.failed : cause instanceof Error ? cause.message : labels.failed);
      return false;
    } finally {
      if (current === revision.current) setPending(false);
    }
  }

  function onAction(extensionKind: ProjectExtensionKind, id: string, action: 'enable' | 'disable' | 'update' | 'remove') {
    void mutate(`/${extensionKind}/${encodeURIComponent(id)}`, action === 'remove' ? 'DELETE' : 'POST',
      action === 'remove' ? undefined : { action });
  }

  async function onImport(event: FormEvent) {
    event.preventDefault();
    let body: { kind: ProjectExtensionKind; source?: string; server?: object };
    if (kind === 'mcp' && serverJson.trim()) {
      try {
        const server: unknown = JSON.parse(serverJson);
        if (!server || typeof server !== 'object' || Array.isArray(server)) throw new Error(labels.invalidJson);
        body = { kind, server };
      } catch {
        setError(labels.invalidJson);
        return;
      }
    } else {
      if (!source.trim()) {
        setError(labels.sourceRequired);
        return;
      }
      body = { kind, source: source.trim() };
    }
    if (await mutate('', 'POST', body)) {
      setSource('');
      setServerJson('');
    }
  }

  const installed = new Set((kind === 'skill' ? data?.skills : data?.mcpServers)?.map((item) => item.id));
  const catalog = (kind === 'skill' ? data?.catalog.skills : data?.catalog.mcpServers) ?? [];
  const templates = kind === 'mcp' ? data?.catalog.mcpTemplates ?? [] : [];
  const template = templates.find((item) => `template:${item.id}` === catalogId);
  const requiredFields = [...(template?.envFields ?? []), ...(template?.headerFields ?? [])]
    .filter((field) => field.required).map((field) => field.key);
  const templateHomepage = safeHomepage(template?.homepage);

  async function onAddCatalog(event: FormEvent) {
    event.preventDefault();
    if (template) {
      setServerJson(JSON.stringify({ id: template.id, templateId: template.id, label: template.label, transport: template.transport,
        enabled: true, ...(template.command ? { command: template.command } : {}),
        ...(template.args ? { args: template.args } : {}), ...(template.url ? { url: template.url } : {}),
        ...(template.envFields?.length ? { env: Object.fromEntries(template.envFields.map((field) => [field.key, ''])) } : {}),
        ...(template.headerFields?.length ? { headers: Object.fromEntries(template.headerFields.map((field) => [field.key, ''])) } : {}),
      }, null, 2));
      setSource('');
      return;
    }
    if (catalogId && await mutate('', 'POST', { kind, catalogId })) setCatalogId('');
  }

  return (
    <div className={styles.panel} data-testid="project-extensions-panel" aria-busy={pending}>
      <header className={styles.header}>
        {embedded ? null : <h2>{labels.title}</h2>}
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => void load()}>{labels.refresh}</Button>
      </header>
      <p className={styles.muted}>{labels.scope}</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {pending && <p role="status" className={styles.muted}>{data ? labels.saving : labels.loading}</p>}
      {data && <>
        <ExtensionList kind="skill" rows={data.skills} labels={labels} translate={translate} locale={locale} pending={pending} onAction={onAction} />
        {data.defaultSkills?.length ? (
          <section className={styles.section} aria-label={labels.defaults} data-testid="project-default-skills">
            <h3>{labels.defaults}</h3>
            <p className={styles.muted}>{labels.defaultsHint}</p>
            <ul className={styles.defaultSkills}>
              {data.defaultSkills.map((skill) => (
                <li key={skill.id} title={skill.description}>{skill.displayName?.[locale] ?? skill.name}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <ExtensionList kind="mcp" rows={data.mcpServers} labels={labels} translate={translate} locale={locale} pending={pending} onAction={onAction} />
        <div className={styles.forms}>
          <label className={styles.field} htmlFor={`${formId}-kind`}>
            {labels.kind}
            <select id={`${formId}-kind`} value={kind} disabled={pending}
              onChange={(event) => { setKind(event.target.value as ProjectExtensionKind); setCatalogId(''); }}>
              <option value="skill">{labels.skill}</option>
              <option value="mcp">{labels.mcp}</option>
            </select>
          </label>
          <form onSubmit={(event) => void onAddCatalog(event)} className={styles.form}>
            <label className={styles.field} htmlFor={`${formId}-catalog`}>
              {labels.catalog}
              <select id={`${formId}-catalog`} value={catalogId} disabled={pending}
                onChange={(event) => setCatalogId(event.target.value)}>
                <option value="">{labels.select}</option>
                {catalog.filter((item) => !installed.has(item.id)).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
                {templates.length > 0 && <optgroup label={labels.templates}>
                  {templates.map((item) => <option key={item.id} value={`template:${item.id}`}>{item.label}</option>)}
                </optgroup>}
              </select>
            </label>
            {requiredFields.length > 0 && (
              <p className={styles.muted}>{labels.requiredConfiguration}: <code>{requiredFields.join(', ')}</code></p>
            )}
            {templateHomepage && (
              <a href={templateHomepage} target="_blank" rel="noopener noreferrer">{labels.homepage}</a>
            )}
            <Button size="sm" variant="secondary" type="submit" disabled={pending || !catalogId}>
              {template ? labels.configure : labels.add}
            </Button>
          </form>
          <form onSubmit={(event) => void onImport(event)} className={styles.form} aria-label={labels.importTitle}>
            <h3>{labels.importTitle}</h3>
            <label className={styles.field} htmlFor={`${formId}-source`}>
              {labels.location}
              <input id={`${formId}-source`} value={source} disabled={pending} spellCheck={false}
                placeholder={labels.locationHint} onChange={(event) => setSource(event.target.value)} />
            </label>
            {kind === 'mcp' && <label className={styles.field} htmlFor={`${formId}-server`}>
              {labels.config}
              <textarea id={`${formId}-server`} rows={7} value={serverJson} disabled={pending} spellCheck={false}
                placeholder={labels.configHint} onChange={(event) => setServerJson(event.target.value)} />
            </label>}
            <Button size="sm" variant="secondary" type="submit" disabled={pending}>{labels.import}</Button>
          </form>
        </div>
      </>}
    </div>
  );
}

export function ProjectExtensionsPanel(props: { projectId: string; locale: string; embedded?: boolean }) {
  return <ExtensionManager key={props.projectId} {...props} />;
}

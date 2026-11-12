import type { TrackingProjectKind } from './shared-enums.js';

export type TrackingWorkspaceScope = 'official' | 'personal' | 'unknown';
export type TrackingWorkspacePage = 'home' | 'community' | 'drafts' | 'all_projects' | 'plugins' | 'project';
export type TrackingProjectCollectionPage = 'home' | 'drafts' | 'all_projects';
export type TrackingCountBucket = '0' | '1' | '2_5' | '6_10' | '11_plus';
export type TrackingProjectRelation = 'self' | 'unknown';

export interface EntryNavigationClickProps {
  page_name: TrackingWorkspacePage;
  area: 'entry_nav';
  element: 'nav_item' | 'search' | 'account_menu_trigger';
  target?: TrackingWorkspacePage | 'search' | 'account_menu';
  entry_from?: 'sidebar';
}

export interface AccountMenuClickProps {
  page_name: TrackingWorkspacePage;
  area: 'account_menu';
  element: 'settings' | 'github_help' | 'feature_request' | 'github' | 'discord' | 'feishu' | 'twitter' | 'email';
}

export interface ProjectCollectionClickProps {
  page_name: TrackingProjectCollectionPage;
  area: 'project_collection';
  element: 'project_open' | 'more_menu' | 'rename' | 'duplicate' | 'delete' | 'multi_select_toggle' | 'bulk_delete' | 'filter' | 'sort' | 'view_toggle';
  project_key?: string;
  project_relation?: TrackingProjectRelation;
  selection_count_bucket?: TrackingCountBucket;
  filter_type?: 'project_type';
  filter_value?: string;
  sort_value?: 'updated_desc' | 'updated_asc' | 'name_asc';
  view_value?: 'grid' | 'list';
}

export interface CommunityTemplateClickProps {
  page_name: 'community';
  area: 'community_templates';
  element: 'template_detail' | 'copy_prompt' | 'remix' | 'use_prompt' | 'filter';
  template_key?: string;
  template_type?: string;
  resource_scope?: TrackingWorkspaceScope;
  filter_type?: 'category' | 'subtype';
  filter_value?: string;
  use_source?: 'card' | 'detail_modal';
  use_action?: 'use' | 'use_with_query';
}

export interface ExtensionMarketplaceClickProps {
  page_name: 'plugins';
  area: 'extension_marketplace';
  element: 'details' | 'use' | 'add' | 'create' | 'filter';
  extension_key?: string;
  extension_kind: 'expert_plugin' | 'skill';
  resource_scope: TrackingWorkspaceScope;
}

export interface WorkspaceSurfaceViewProps {
  page_name: TrackingWorkspacePage;
  area: 'account_menu';
}

export interface WorkspaceProjectActionResultProps {
  page_name: TrackingProjectCollectionPage;
  area: 'project_collection';
  action: 'duplicate' | 'delete' | 'bulk_delete';
  result: 'success' | 'partial_success' | 'failed';
  requested_count: number;
  succeeded_count: number;
  failed_count: number;
  duration_ms: number;
  error_code?: string;
}

export interface WorkspaceResourceActionResultProps {
  page_name: 'plugins';
  area: 'workspace_resource';
  resource_kind: 'expert_plugin' | 'skill';
  resource_scope: TrackingWorkspaceScope;
  action: 'download_plugin' | 'add';
  result: 'success' | 'failed';
  duration_ms: number;
  error_code?: string;
}

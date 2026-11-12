
import type { TrackingPageName } from './event-names.js';
import type { OnboardingPageViewProps, TrackingChatPanelPageViewSource } from './onboarding.js';
// --- Generic page_view (existing surfaces) ---
//
// Covers all page-level page_views that don't carry surface-specific
// fields. `chat_panel` is the only one that uses the optional `source`.
export interface GenericPageViewProps {
  page_name: Exclude<
    TrackingPageName,
    'onboarding' | 'studio'
  >;
  source?: TrackingChatPanelPageViewSource;
}

// Setup views carry their session and step; other views use the generic shape.
export type PageViewProps =
  GenericPageViewProps | OnboardingPageViewProps;


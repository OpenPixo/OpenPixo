import type { ServerContext } from './server-context.js';
import type { RegisterActiveContextRoutesDeps } from './routes/active-context.js';
import type { RegisterAgentCapabilityRoutesDeps } from './routes/agent-capabilities.js';
import type { RegisterProjectExtensionRoutesDeps } from './routes/project-extensions.js';
import type { RegisterStoreRoutesDeps } from './routes/store.js';
import type { RegisterChatRoutesDeps } from './routes/chat.js';
import type { RegisterImportRoutesDeps, RegisterProjectExportRoutesDeps } from './import-export-routes.js';
import type { RegisterHostToolsRoutesDeps } from './routes/host-tools.js';
import type { RegisterGameVerifyRoutesDeps } from './routes/game-verify.js';
import type { RegisterGameTuningRoutesDeps } from './routes/game-tuning.js';
import type { RegisterMcpRoutesDeps } from './mcp-routes.js';
import type { RegisterMediaRoutesDeps } from './routes/media.js';
import type { RegisterProjectChatArtifactRoutesDeps } from './routes/project/chat-artifacts.js';
import type { RegisterProjectEngineRoutesDeps } from './routes/project/engine.js';
import type { RegisterProjectArtifactRoutesDeps, RegisterProjectFileRoutesDeps, RegisterProjectRoutesDeps, RegisterProjectUploadRoutesDeps } from './routes/project/index.js';
import type { RegisterRunRoutesDeps } from './routes/runs.js';
import type { RegisterSocialShareRoutesDeps } from './routes/social-share.js';
import type { RegisterStaticResourceRoutesDeps } from './routes/static-resource.js';
import type { RegisterXaiRoutesDeps } from './routes/xai.js';

type AllRegisteredRouteDeps =
  & RegisterActiveContextRoutesDeps
  & RegisterAgentCapabilityRoutesDeps
  & RegisterProjectExtensionRoutesDeps
  & RegisterStoreRoutesDeps
  & RegisterChatRoutesDeps
  & RegisterHostToolsRoutesDeps
  & RegisterGameVerifyRoutesDeps
  & RegisterGameTuningRoutesDeps
  & RegisterImportRoutesDeps
  & RegisterMcpRoutesDeps
  & RegisterMediaRoutesDeps
  & RegisterProjectArtifactRoutesDeps
  & RegisterProjectChatArtifactRoutesDeps
  & RegisterProjectEngineRoutesDeps
  & RegisterProjectExportRoutesDeps
  & RegisterProjectFileRoutesDeps
  & RegisterProjectRoutesDeps
  & RegisterProjectUploadRoutesDeps
  & RegisterRunRoutesDeps
  & RegisterSocialShareRoutesDeps
  & RegisterStaticResourceRoutesDeps
  & RegisterXaiRoutesDeps;

type Assert<T extends true> = T;
type ServerContextCoversRouteDeps = Assert<ServerContext extends AllRegisteredRouteDeps ? true : false>;

export function assertServerContextSatisfiesRoutes(ctx: ServerContextCoversRouteDeps extends true ? ServerContext : never): void {
  void ctx;
}

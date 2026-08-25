// The imported app already contains its complete API surface. Keeping it in
// the shared API artifact means the frontend can use the workspace /api proxy.
// @ts-ignore - the preserved CommonJS server has no declaration file.
import legacyApp from "./legacy-server.cjs";

export default legacyApp;

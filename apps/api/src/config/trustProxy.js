export const RENDER_TRUST_PROXY_HOPS = 1;

export function isRenderEnvironment(env = process.env) {
  return Boolean(
    env.RENDER_SERVICE_NAME ||
    env.RENDER_SERVICE_ID ||
    env.RENDER_EXTERNAL_URL ||
    env.RENDER_GIT_COMMIT
  );
}

export function resolveTrustProxySetting(env = process.env) {
  return isRenderEnvironment(env) ? RENDER_TRUST_PROXY_HOPS : false;
}

export function configureTrustProxy(app, env = process.env) {
  const trustProxySetting = resolveTrustProxySetting(env);
  app.set("trust proxy", trustProxySetting);
  return trustProxySetting;
}

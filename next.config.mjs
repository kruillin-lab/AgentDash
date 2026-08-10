/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard talks to local-only services; never expose this on a public host.
  allowedDevOrigins: ["http://localhost:3007", "http://127.0.0.1:3007"],
  // Keep server components able to spawn local helper processes (opencode serve, hermes CLI).
  experimental: {
    serverComponentsExternalPackages: [],
    // Run src/instrumentation.ts register() once at server startup so the mission
    // control dispatch gate is wired and fail-closed before any request is served.
    instrumentationHook: true,
  },
  // src/instrumentation.ts starts the Node-only controller runtime via a dynamic
  // import guarded to the Node.js runtime. The edge and client graphs must not
  // bundle that Node-only module (fs/crypto/path), so stub it out there; the
  // import is never executed outside the Node runtime.
  webpack: (config, { isServer, nextRuntime, webpack }) => {
    if (!isServer || nextRuntime === "edge") {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /mission-control[\\/]runtime[\\/]composition/,
        }),
      );
    }
    return config;
  },
}

export default nextConfig
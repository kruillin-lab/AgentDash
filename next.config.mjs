/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard talks to local-only services; never expose this on a public host.
  allowedDevOrigins: ["http://localhost:3007", "http://127.0.0.1:3007"],
  // Keep server components able to spawn local helper processes (opencode serve, hermes CLI).
  experimental: {
    serverComponentsExternalPackages: [],
  },
}

export default nextConfig
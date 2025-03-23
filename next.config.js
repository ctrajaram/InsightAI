/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow cross-origin requests during development
    allowedDevOrigins: ['127.0.0.1'],
  },
  // Disable ESLint during build
  eslint: {
    // Don't run ESLint during build
    ignoreDuringBuilds: true,
  },
  // Disable TypeScript type checking during build
  typescript: {
    // Don't run type checking during build
    ignoreBuildErrors: true,
  },
  // Add any other Next.js configuration options here
};

module.exports = nextConfig;

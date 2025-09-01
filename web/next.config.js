/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: ['fabric'],
    webpack: (config) => {
      config.externals.push({
        'canvas': 'canvas',
        'jsdom': 'jsdom'
      });
      return config;
    }
  };
  
  module.exports = nextConfig;

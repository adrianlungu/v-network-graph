const path = require('path');
module.exports = {
  "stories": [
    "../src/**/*.stories.mdx",
    "../src/**/*.stories.@(js|jsx|ts|tsx)"
  ],
  "addons": [
    "@storybook/addon-links",
    "@storybook/addon-essentials",
    "@storybook/addon-interactions"
  ],
  "framework": {
    "name": "@storybook/vue3-vite",
    "options": {}
  },
  async viteFinal(config) {
    return {
      ...config,
      resolve: {
        alias: [
          { find: "vue", replacement: "vue/dist/vue.esm-bundler.js" },
          { find: "@/", replacement: path.join(__dirname, "../src/")}
        ]
      }
    }
  }
}
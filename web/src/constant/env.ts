export const APP_VERSION = __APP_VERSION__ || "dev";
export const APP_REPOSITORY_URL = import.meta.env.VITE_REPOSITORY_URL || "https://github.com/fujunchao/infinite-canvas";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// 官方插件清单地址:CI 发布到 plugins-dist 分支,经 jsDelivr 远程拉取;可用环境变量覆盖成自建来源
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/fujunchao/infinite-canvas@plugins-dist/official-plugins.json";

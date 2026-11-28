// 联机配置（构建期）
// 默认：微信小游戏走「微信云开发」，不需要服务器和备案域名。
// CLOUD_ENV 填当前小游戏绑定的云开发环境；只有一个环境时留空也能用默认环境。
// 调试自建 WebSocket 时，把 CLOUD_ON 设为 false，或执行 wx.setStorageSync('gx13_cloud','0')。
module.exports = {
  CLOUD_ON: true,
  CLOUD_ENV: 'cloud1-d7g8xcknn7afb1637',
  SERVER_URL: ''
};

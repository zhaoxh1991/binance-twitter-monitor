# Binance Twitter Alpha Monitor 🚀

实时监控币安相关推特账号，发现 Alpha / 空投 / 上币信息，第一时间推送。

## 监控账号

| 推特账号 | 说明 |
|----------|------|
| @binance | 币安官方 |
| @cz_binance | CZ 赵长鹏 |
| @BinanceResearch | 币安研究 |
| @BinanceFutures | 币安合约 |
| @BinanceLabs | 币安实验室/MCG |
| @BNBCHAIN | BNB链 |
| @heyibinance | 何一 |
| @BinanceHelpDesk | 币安帮助 |
| @BinanceSquare | 币安广场 |

## 监控关键词（Alpha/空投相关）

airdrop, 空投, listing, 上线, launchpool, launchpad, 
megadrop, holder airdrop, new token, new coin, 
alpha, farming, staking, 新币挖矿, 即将上线...

## 部署步骤

### 1. Fork 这个仓库

点击右上角 Fork 按钮，把仓库复制到你的 GitHub 账号下。

### 2. 启用 GitHub Actions

- 进入你的仓库 → **Actions** 标签
- 如果看到提示 "Workflows aren't available in this repository yet"，点击 **"I understand my workflows, go ahead and enable them"**
- 找到 **"Binance Twitter Alpha Monitor"** 工作流
- 点击 **"Enable workflow"**

### 3. （可选）配置 Webhook 推送

如果你想以其他方式接收推送：

- 进入仓库 **Settings → Secrets and variables → Actions**
- 点击 **New repository secret**
- Name: `ALPHA_WEBHOOK_URL`
- Value: 你的 Webhook 地址

### 4. 手动触发测试

- 进入 **Actions** 页面
- 点击 **"Binance Twitter Alpha Monitor"**
- 点击 **"Run workflow"** → 绿色按钮
- 确认工作流能正常运行

### 5. 之后每10分钟自动运行

## 数据文件

- `data/tweets_db.json` — 已抓取的推文数据库
- `data/new_alpha_tweets.json` — 最新发现的 Alpha 推文
- `data/monitor_log.json` — 运行日志

## 环境要求

- Node.js 20+
- Playwright (自动安装 Chromium)

## 工作原理

```
Twitter API ⟶ GitHub Actions (每10分钟) ⟶ 更新 data/ 目录
                                              ↓
                                     你的 AI 助手读取数据
                                              ↓
                                     推送到你的微信 📱
```

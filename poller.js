#!/usr/bin/env node
/**
 * OpenClaw-side: Binance Alpha Tweet Poller
 * 
 * Polls the GitHub repo for new alpha tweets and pushes to user via WeChat.
 * Uses GitHub API (which is accessible from China) and jsDelivr CDN as fallback.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, 'data');
const STATE_FILE = join(STATE_DIR, 'pushed_tweets.json');

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

// Read config from local .env file (not pushed to GitHub)
let GITHUB_TOKEN = '';
try {
  const envPath = join(__dirname, '.env');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/GITHUB_TOKEN=(.+)/);
    if (match) GITHUB_TOKEN = match[1].trim();
  }
} catch (e) {}
// Also try env
if (!GITHUB_TOKEN) GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const REPO = 'zhaoxh1991/binance-twitter-monitor';
const BRANCH = 'main';
const FILE_PATH = 'data/new_alpha_tweets.json';

let state = { pushed: {} };
if (existsSync(STATE_FILE)) {
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch (e) {}
}
if (!state.pushed) state.pushed = {};

async function fetchViaGitHubAPI() {
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'binance-alpha-monitor'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error(`GitHub API: ${resp.status}`);
  const data = await resp.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

async function fetchViaJsDelivr() {
  const url = `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${FILE_PATH}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`jsDelivr: ${resp.status}`);
  return await resp.json();
}

async function fetchAlphaData() {
  const errors = [];
  
  // Try GitHub API first (most reliable with token)
  try {
    console.log('Trying GitHub API...');
    const data = await fetchViaGitHubAPI();
    if (Array.isArray(data)) return data;
  } catch (e) {
    errors.push(`GitHub API: ${e.message}`);
  }
  
  // Fallback to jsDelivr CDN
  try {
    console.log('Trying jsDelivr CDN...');
    const data = await fetchViaJsDelivr();
    if (Array.isArray(data)) return data;
  } catch (e) {
    errors.push(`jsDelivr: ${e.message}`);
  }
  
  console.error('All sources failed:', errors.join('; '));
  return [];
}

async function main() {
  console.log(`[Binance Alpha Poller] Checking for new alpha tweets...`);
  
  const alphaTweets = await fetchAlphaData();
  
  if (alphaTweets.length === 0) {
    console.log('No alpha tweets found yet.');
    return;
  }
  
  const newTweets = alphaTweets.filter(t => !state.pushed[t.id]);
  
  if (newTweets.length === 0) {
    console.log('No new alpha tweets to push.');
    return;
  }
  
  console.log(`\n🔥 Found ${newTweets.length} new alpha tweet(s)!`);
  
  let message = '';
  
  for (const tweet of newTweets) {
    const formatted = formatAlphaMessage(tweet);
    console.log('\n' + formatted);
    message += formatted + '\n\n---\n\n';
    
    state.pushed[tweet.id] = {
      pushed_at: new Date().toISOString(),
      tweet: tweet
    };
  }
  
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  
  // Output delivery payload for cron
  console.log('\n===DELIVERY_START===');
  console.log(message.trim());
  console.log('===DELIVERY_END===');
}

function formatAlphaMessage(tweet) {
  const accountName = tweet.account_name || `@${tweet.account}`;
  const keywords = tweet.matched_keywords 
    ? tweet.matched_keywords.map(k => `#${k}`).join(' ') 
    : '#alpha';
  
  let text = tweet.text || '';
  if (text.length > 280) text = text.substring(0, 277) + '...';
  
  const ts = tweet.timestamp || tweet.detected_at || new Date().toISOString();
  const timeStr = new Date(ts).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'});
  
  return [
    `🔥 **Alpha 情报 | ${accountName}**`,
    ``,
    `${keywords}`,
    ``,
    `${text}`,
    ``,
    `🔗 ${tweet.url}`,
    `⏱ ${timeStr}`
  ].join('\n');
}

main().catch(console.error);

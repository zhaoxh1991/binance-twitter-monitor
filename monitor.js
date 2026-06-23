#!/usr/bin/env node
/**
 * Binance Twitter Alpha Monitor
 * 
 * Scrapes Binance-related Twitter accounts, filters for alpha/airdrop content,
 * and outputs new findings.
 * 
 * Designed to run in GitHub Actions (every 10 min) or locally.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_FILE = join(DATA_DIR, 'tweets_db.json');
const NEW_FILE = join(DATA_DIR, 'new_alpha_tweets.json');
const LOG_FILE = join(DATA_DIR, 'monitor_log.json');

// Load config
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Load existing tweet database
let tweetDB = { seen: {} };
if (existsSync(DB_FILE)) {
  try {
    tweetDB = JSON.parse(readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error loading tweet DB, starting fresh:', e.message);
  }
}
if (!tweetDB.seen) tweetDB.seen = {};

async function scrapeTwitter(username) {
  /**
   * Scrapes tweets from a Twitter profile using Playwright.
   * Returns an array of tweet objects.
   */
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    
    const page = await context.newPage();
    
    // Navigate to Twitter profile
    const url = `https://twitter.com/${username}`;
    console.log(`Fetching tweets from @${username}...`);
    
    await page.goto(url, { 
      waitUntil: 'networkidle', 
      timeout: 30000 
    });
    
    // Wait for tweets to load
    await page.waitForTimeout(3000);
    
    // Scroll down a bit to load more tweets
    await page.evaluate(() => {
      window.scrollBy(0, 500);
    });
    await page.waitForTimeout(2000);
    
    // Extract tweets
    const tweets = await page.evaluate(() => {
      const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
      const results = [];
      
      tweetElements.forEach((tweet) => {
        // Get tweet text
        const textElement = tweet.querySelector('[data-testid="tweetText"]');
        const text = textElement ? textElement.textContent : '';
        
        // Get tweet timestamp
        const timeElement = tweet.querySelector('time');
        const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';
        
        // Get tweet URL/id
        const linkElement = tweet.querySelector('a[href*="/status/"]');
        const href = linkElement ? linkElement.getAttribute('href') : '';
        const tweetId = href ? href.match(/\/status\/(\d+)/)?.[1] : '';
        
        // Get tweet link
        const tweetUrl = href ? `https://twitter.com${href}` : '';
        
        if (text && tweetId) {
          results.push({
            id: tweetId,
            text: text,
            url: tweetUrl,
            timestamp: timestamp,
            time: new Date(timestamp).getTime()
          });
        }
      });
      
      return results;
    });
    
    console.log(`Found ${tweets.length} tweets from @${username}`);
    return tweets;
    
  } catch (error) {
    console.error(`Error scraping @${username}:`, error.message);
    return [];
  } finally {
    await browser.close();
  }
}

function checkForAlpha(tweets, username, accountName) {
  /**
   * Checks if tweets match alpha/airdrop criteria.
   * Returns tweets that are:
   * 1. New (not seen before)
   * 2. Contain alpha keywords
   */
  const newAlphaTweets = [];
  const keywords = config.alpha_keywords.map(k => k.toLowerCase());
  
  for (const tweet of tweets) {
    // Skip already seen tweets
    if (tweetDB.seen[tweet.id]) continue;
    
    // Mark as seen
    tweetDB.seen[tweet.id] = true;
    
    // Check for alpha keywords
    const tweetText = tweet.text.toLowerCase();
    const matchedKeywords = keywords.filter(k => tweetText.includes(k));
    
    if (matchedKeywords.length > 0) {
      newAlphaTweets.push({
        id: tweet.id,
        account: username,
        account_name: accountName,
        text: tweet.text,
        url: tweet.url,
        timestamp: tweet.timestamp,
        matched_keywords: matchedKeywords,
        detected_at: new Date().toISOString()
      });
      
      console.log(`  🔥 ALPHA! @${username}: matched keywords [${matchedKeywords.join(', ')}]`);
    }
  }
  
  return newAlphaTweets;
}

async function main() {
  console.log('=== Binance Twitter Alpha Monitor ===');
  console.log(`Start time: ${new Date().toISOString()}`);
  console.log(`Accounts to monitor: ${Object.keys(config.accounts).join(', ')}`);
  console.log('');
  
  const allNewAlphaTweets = [];
  
  for (const [username, info] of Object.entries(config.accounts)) {
    console.log(`\n--- Checking @${username} (${info.name}) ---`);
    
    const tweets = await scrapeTwitter(username);
    
    if (tweets.length === 0) {
      console.log(`  No tweets found for @${username}`);
      continue;
    }
    
    const alphaTweets = checkForAlpha(tweets, username, info.name);
    allNewAlphaTweets.push(...alphaTweets);
    
    // Rate limiting between accounts
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Save tweet database
  writeFileSync(DB_FILE, JSON.stringify(tweetDB, null, 2));
  
  // Save new alpha tweets
  writeFileSync(NEW_FILE, JSON.stringify(allNewAlphaTweets, null, 2));
  
  // Save log
  const logEntry = {
    timestamp: new Date().toISOString(),
    accounts_checked: Object.keys(config.accounts).length,
    total_tweets_seen: Object.keys(tweetDB.seen).length,
    new_alpha_found: allNewAlphaTweets.length,
    new_alpha: allNewAlphaTweets
  };
  
  const logs = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf-8')) : [];
  logs.unshift(logEntry);
  // Keep last 100 logs
  if (logs.length > 100) logs.length = 100;
  writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  
  console.log('\n=== Summary ===');
  console.log(`Total new alpha tweets found: ${allNewAlphaTweets.length}`);
  for (const t of allNewAlphaTweets) {
    console.log(`\n🔥 @${t.account}:`);
    console.log(`   ${t.text.substring(0, 200)}`);
    console.log(`   ${t.url}`);
  }
}

main().catch(console.error);

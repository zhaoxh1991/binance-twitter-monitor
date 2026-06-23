#!/usr/bin/env node
/**
 * Binance Square Alpha Monitor
 * 
 * Monitors Binance Square profile @binancezh for posts containing "alpha" or "tge".
 * Uses Playwright to handle WAF/Cloudflare challenges.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_FILE = join(DATA_DIR, 'seen.json');
const NEW_FILE = join(DATA_DIR, 'new_alpha.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

let db = { seen: {} };
if (existsSync(DB_FILE)) { try { db = JSON.parse(readFileSync(DB_FILE,'utf-8')); } catch {} }
if (!db.seen) db.seen = {};

const KEYWORDS = ['alpha', 'tge'];
const TARGET_URL = 'https://www.binance.com/zh-CN/square/profile/binancezh';

async function scrapeSquare() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN'
    });

    const page = await context.newPage();
    
    console.log(`Loading ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { 
      waitUntil: 'networkidle', 
      timeout: 45000 
    }).catch(e => console.log(`  Nav: ${e.message.substring(0,40)}`));
    
    // Wait for WAF challenge to complete and content to load
    console.log('  Waiting for content...');
    await page.waitForTimeout(8000);
    
    // Wait for posts to appear (wait up to 15s)
    try {
      await page.waitForSelector('[class*="post"], [class*="Post"], [class*="article"], [class*="Article"], [class*="content"], [class*="Content"]', 
        { timeout: 15000 });
    } catch { console.log('  No post selector found, trying full page text'); }
    
    await page.waitForTimeout(3000);
    
    // Scroll to load more
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);
    
    // Extract ALL text content
    const pageText = await page.evaluate(() => document.body.innerText);
    
    // Extract posts/articles
    const posts = await page.evaluate(() => {
      const results = [];
      
      // Try multiple selectors for posts
      const selectors = [
        '[class*="post"]',
        '[class*="Post"]',
        '[class*="article"]',
        '[class*="Article"]',
        '[class*="card"]',
        '[class*="Card"]',
        '[class*="content"]',
        '[class*="Content"]',
        '[class*="feed"]',
        '[class*="Feed"]',
        '[class*="timeline"]',
        '[class*="Timeline"]',
        'article',
        // Binance Square specific
        '[class*="css-"]',
        '[data-testid*="post"]',
        '[data-testid*="Post"]',
      ];
      
      let foundElements = [];
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        if (elements.length > 3) {
          foundElements = Array.from(elements);
          console.log(`Found ${foundElements.length} elements with selector: ${sel}`);
          break;
        }
      }
      
      // If still nothing, just return the whole page text
      if (foundElements.length === 0) {
        return [{ id: 'page_text', text: document.body.innerText.substring(0, 10000) }];
      }
      
      // Look for post elements with text content
      foundElements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.length > 20 && text.length < 5000) {
          // Create a unique ID from text hash
          let hash = 0;
          for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
          }
          results.push({
            id: `post_${Math.abs(hash)}`,
            text: text
          });
        }
      });
      
      return results;
    });
    
    console.log(`\nExtracted ${posts.length} potential posts`);
    
    // Also save full text for debugging
    writeFileSync(join(DATA_DIR, 'debug_page.txt'), pageText.substring(0, 50000));
    
    return { posts, pageText };
    
  } finally {
    await browser.close();
  }
}

function extractRelevantContent(posts, pageText) {
  // Try to find posts/items that contain the keywords
  const results = [];
  const seen = new Set();
  
  // Check each post
  for (const post of posts) {
    const text = post.text.toLowerCase();
    const matched = KEYWORDS.filter(k => text.includes(k));
    
    if (matched.length > 0) {
      const key = text.substring(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          id: post.id,
          text: post.text,
          matched_keywords: matched,
          detected_at: new Date().toISOString()
        });
      }
    }
  }
  
  return results;
}

async function main() {
  console.log('=== Binance Square Alpha Monitor ===');
  console.log(`Profile: @binancezh`);
  console.log(`URL: ${TARGET_URL}`);
  console.log(`Keywords: ${KEYWORDS.join(', ')}`);
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  const { posts, pageText } = await scrapeSquare();
  
  // Find alpha/TGE content
  const alphaItems = extractRelevantContent(posts, pageText);
  
  // Check against database
  const newItems = [];
  for (const item of alphaItems) {
    if (db.seen[item.id]) continue;
    db.seen[item.id] = true;
    newItems.push(item);
  }
  
  // Save database
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  writeFileSync(NEW_FILE, JSON.stringify(newItems, null, 2));
  
  console.log(`\n=== Summary ===`);
  console.log(`Total posts scanned: ${posts.length}`);
  console.log(`Alpha/TGE mentions: ${alphaItems.length}`);
  console.log(`New (not seen before): ${newItems.length}`);
  
  for (const item of newItems) {
    console.log(`\n🔥 Alpha/TGE detected:`);
    console.log(`   ${item.text.substring(0, 300)}`);
  }
  
  // If nothing found with keywords, show what the page contains for debugging
  if (newItems.length === 0 && alphaItems.length === 0) {
    console.log(`\nPage title excerpt: ${pageText.substring(0, 200)}`);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

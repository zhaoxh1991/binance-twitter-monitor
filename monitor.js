#!/usr/bin/env node
/**
 * Binance Square Alpha Monitor
 * 
 * Monitors Binance Square profile @binancezh for posts containing "alpha" or "tge".
 * Uses Playwright to handle WAF/Cloudflare challenges.
 */

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

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
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN'
    });
    
    console.log(`Loading ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { 
      waitUntil: 'networkidle', 
      timeout: 50000 
    }).catch(e => console.log(`  Nav: ${e.message.substring(0,40)}`));
    
    // Wait for WAF and content
    await page.waitForTimeout(6000);
    
    // Scroll many times to load more content
    console.log('  Scrolling...');
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(800);
      if (i % 5 === 0) process.stdout.write('.');
    }
    process.stdout.write('\n');
    await page.waitForTimeout(2000);
    
    // Get ALL text from page
    const pageText = await page.evaluate(() => document.body.innerText);
    writeFileSync(join(DATA_DIR, 'debug_page.txt'), pageText.substring(0, 50000));
    
    // Split into lines/posts
    const lines = pageText.split('\n').filter(l => l.trim().length > 0);
    
    // Group consecutive lines into logical posts
    const posts = [];
    let currentPost = '';
    for (const line of lines) {
      currentPost += line + '\n';
      if (line.length > 30) {
        let hash = 0;
        for (let i = 0; i < currentPost.length; i++) {
          hash = ((hash << 5) - hash) + currentPost.charCodeAt(i);
          hash |= 0;
        }
        posts.push({ id: `post_${Math.abs(hash)}_${posts.length}`, text: currentPost.trim() });
        currentPost = '';
      }
    }
    if (currentPost.trim()) {
      let hash = 0;
      for (let i = 0; i < currentPost.length; i++) {
        hash = ((hash << 5) - hash) + currentPost.charCodeAt(i);
        hash |= 0;
      }
      posts.push({ id: `post_${Math.abs(hash)}`, text: currentPost.trim() });
    }
    
    console.log(`Page: ${pageText.length} chars, ${posts.length} segments`);
    return { posts, pageText };
    
  } finally {
    await browser.close();
  }
}

function extractRelevantContent(posts, pageText) {
  const results = [];
  const seen = new Set();
  
  // Check each post segment for keywords
  for (const post of posts) {
    const text = post.text.toLowerCase();
    const matched = KEYWORDS.filter(k => text.includes(k));
    
    if (matched.length > 0) {
      // Deduplicate by checking if similar text already captured
      const fingerprint = text.substring(0, 80);
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        results.push({
          id: post.id,
          text: post.text,
          matched_keywords: matched,
          detected_at: new Date().toISOString()
        });
      }
    }
  }
  
  // Also scan full page text for keyword mentions and line-level extraction
  const lines = pageText.split('\n');
  for (const line of lines) {
    const t = line.toLowerCase();
    const matched = KEYWORDS.filter(k => t.includes(k));
    if (matched.length > 0 && line.trim().length > 15) {
      const fingerprint = line.substring(0, 60);
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        let hash = 0;
        for (let i = 0; i < line.length; i++) {
          hash = ((hash << 5) - hash) + line.charCodeAt(i);
          hash |= 0;
        }
        results.push({
          id: `line_${Math.abs(hash)}`,
          text: line.trim(),
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

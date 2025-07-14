const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const { execSync } = require('child_process');

// === 配置项 ===
const ROOT_DIR = path.resolve(__dirname);
const POSTS_DIR = path.join(ROOT_DIR, 'source', '_posts');
const IMAGE_DIR = path.join(ROOT_DIR, 'source', 'images');

const WP_POST_API = 'https://blziyuan21.com/wp-json/wp/v2/posts?status=publish&per_page=100';
const WP_CAT_API = 'https://blziyuan21.com/wp-json/wp/v2/categories';

const turndown = new TurndownService();
let categoryMap = {};

// === 获取分类映射 ===
async function fetchCategories() {
  const res = await axios.get(WP_CAT_API);
  res.data.forEach(cat => {
    categoryMap[cat.id] = cat.name;
  });
  console.log(`✅ 获取分类 ${res.data.length} 项`);
}

// === 获取文章列表 ===
async function fetchPosts() {
  const res = await axios.get(WP_POST_API);
  return res.data;
}

// === 下载图片 & 替换链接 ===
async function extractAndDownloadImages(html, slug) {
  const $ = cheerio.load(html);
  const images = [];

  $('img').each((_, img) => {
    const url = $(img).attr('src');
    if (url) images.push(url);
  });

  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  const imageMap = {};

  const downloadPromises = images.map(async (url, index) => {
    const ext = path.extname(url).split('?')[0] || '.jpg';
    const localName = `${slug}-${index}${ext}`;
    const localPath = path.join(IMAGE_DIR, localName);

    try {
      const res = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(localPath, res.data);
      imageMap[url] = `/images/${localName}`;
    } catch (err) {
      console.warn(`❌ 图片下载失败: ${url}`);
    }
  });

  await Promise.all(downloadPromises);
  return imageMap;
}

// === 生成 Markdown ===
async function convertToMarkdown(post) {
  const title = post.title.rendered.replace(/"/g, '\\"');
  const date = post.date;
  const slug = post.slug;
  const contentHtml = post.content.rendered;

  if (!contentHtml || contentHtml.includes('Page Not Found')) {
    console.warn(`⚠️ 跳过无效文章：${slug}`);
    return null;
  }

  const cats = (post.categories || []).map(id => categoryMap[id] || '未分类');
  const imageMap = await extractAndDownloadImages(contentHtml, slug);

  // 将远程图片 URL 替换为本地路径
  let markdownContent = turndown.turndown(contentHtml);
  for (const [remote, local] of Object.entries(imageMap)) {
    markdownContent = markdownContent.replaceAll(remote, local);
  }

  const frontMatter = `---
title: "${title}"
date: ${date}
categories:
${cats.map(c => `  - ${c}`).join('\n')}
tags:
  - wordpress
---

${markdownContent}
`;

  return { slug, content: frontMatter };
}

// === 写入文件 + Git 推送 ===
async function savePosts() {
  fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.mkdirSync(IMAGE_DIR, { recursive: true });

  await fetchCategories();
  const posts = await fetchPosts();
  let count = 0;

  for (const post of posts) {
    const md = await convertToMarkdown(post);
    if (!md) continue;

    const filePath = path.join(POSTS_DIR, `${md.slug}.md`);
    fs.writeFileSync(filePath, md.content);
    console.log(`✅ 写入：${md.slug}.md`);
    count++;
  }

  if (count === 0) {
    console.log('📭 没有新文章需要同步');
    return;
  }

  // Git 操作
  execSync('git add source/_posts source/images', { cwd: ROOT_DIR });
  execSync(`git commit -m "sync: update from WordPress ${new Date().toISOString()}" || echo "no changes"`, { cwd: ROOT_DIR });
  execSync('git push origin main', { cwd: ROOT_DIR });
  console.log('🚀 同步完成并推送到 GitHub');
}

// === 执行主流程 ===
savePosts().catch(err => {
  console.error('❌ 同步失败:', err.message);
});

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const TurndownService = require('turndown');

const turndown = new TurndownService({ headingStyle: 'atx' });

// === 配置项 ===
const ROOT_DIR = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT_DIR, 'source/_posts');
const IMAGES_DIR = path.join(ROOT_DIR, 'source/images/wp');
const WP_POST_API = 'https://blziyuan21.com/wp-json/wp/v2/posts?status=publish&per_page=100';
const WP_CAT_API = 'https://blziyuan21.com/wp-json/wp/v2/categories';

// 分类 ID → 名称 映射表
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

// === 生成唯一 slug ===
function generateSlug(title) {
  return crypto.createHash('md5').update(title + Date.now()).digest('hex').slice(0, 8);
}

// === 下载文章中的图片 ===
async function extractAndDownloadImages(contentHtml, slug) {
  const regex = /<img[^>]*src=["']([^"']+)["']/g;
  const imageMap = {};
  let match;

  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  while ((match = regex.exec(contentHtml)) !== null) {
    const url = match[1];
    try {
      const ext = path.extname(url).split('?')[0] || '.jpg';
      const filename = `${slug}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const savePath = path.join(IMAGES_DIR, filename);
      const localUrl = `/images/wp/${filename}`;

      const res = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(savePath, res.data);
      imageMap[url] = localUrl;
      console.log(`🖼 下载图片: ${filename}`);
    } catch (err) {
      console.warn(`⚠️ 图片下载失败: ${url}`);
    }
  }

  return imageMap;
}

// === 生成 Markdown 文件 ===
async function convertToMarkdown(post) {
  const title = post.title.rendered.replace(/"/g, '\\"');
  const date = post.date;
  const slug = generateSlug(title);
  const permalink = `/posts/${slug}/`;
  const contentHtml = post.content.rendered;

  if (!contentHtml || contentHtml.includes('Page Not Found')) return null;

  const cats = (post.categories || []).map(id => categoryMap[id] || '未分类');

  const imageMap = await extractAndDownloadImages(contentHtml, slug);
  let markdownContent = turndown.turndown(contentHtml);

  for (const [remote, local] of Object.entries(imageMap)) {
    markdownContent = markdownContent.replaceAll(remote, local);
  }

  const frontMatter = `---
title: "${title}"
date: ${date}
slug: ${slug}
permalink: ${permalink}
categories:
${cats.map(c => `  - ${c}`).join('\n')}
tags:
  - wordpress
---

${markdownContent}
`;

  return { slug, content: frontMatter };
}

// === 执行同步 ===
async function syncPosts() {
  await fetchCategories();
  const posts = await fetchPosts();
  let count = 0;

  for (const post of posts) {
    const md = await convertToMarkdown(post);
    if (!md) continue;

    const filename = path.join(POSTS_DIR, `${md.slug}.md`);
    fs.writeFileSync(filename, md.content);
    console.log(`✅ 已保存: ${md.slug}.md`);
    count++;
  }

  if (count === 0) {
    console.log('📭 没有需要同步的文章');
    return;
  }

  // Git 操作
  execSync('git add source/_posts source/images', { cwd: ROOT_DIR });
  execSync(`git commit -m "sync: update from WordPress ${new Date().toISOString()}" || echo "no changes"`, { cwd: ROOT_DIR });
  execSync('git push origin main', { cwd: ROOT_DIR });
  console.log('🚀 同步并推送到 GitHub 完成');
}

// === 启动主流程 ===
syncPosts().catch(console.error);

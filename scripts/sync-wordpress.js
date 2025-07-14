const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// === 配置项 ===
const ROOT_DIR = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT_DIR, 'source/_posts');
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

// === 生成 Markdown 格式 ===
function convertToMarkdown(post) {
  const title = post.title.rendered.replace(/"/g, '\\"');
  const date = post.date;
  const slug = post.slug;
  const contentHtml = post.content.rendered;

  // 跳过无效内容（如404页面）
  if (!contentHtml || contentHtml.includes('Page Not Found')) {
    console.warn(`⚠️ 跳过无效文章：${slug}`);
    return null;
  }

  // 提取分类名
  const cats = (post.categories || []).map(id => categoryMap[id] || '未分类');
  const contentText = contentHtml
    .replace(/<\/?[^>]+(>|$)/g, '') // 移除HTML标签
    .replace(/&nbsp;/g, ' ');

  const frontMatter = `---
title: "${title}"
date: ${date}
categories:
${cats.map(c => `  - ${c}`).join('\n')}
tags:
  - wordpress
---

${contentText}
`;

  return { slug, content: frontMatter };
}

// === 保存为 Markdown 文件 ===
async function savePosts() {
  await fetchCategories();
  const posts = await fetchPosts();
  let count = 0;

  for (const post of posts) {
    const md = convertToMarkdown(post);
    if (!md) continue;

    const filename = path.join(POSTS_DIR, `${md.slug}.md`);
    fs.writeFileSync(filename, md.content);
    console.log(`✅ 已保存：${md.slug}.md`);
    count++;
  }

  if (count === 0) {
    console.log('📭 没有需要同步的文章');
    return;
  }

  // Git 操作
  execSync('git add source/_posts', { cwd: ROOT_DIR });
  execSync(`git commit -m "sync: update from WordPress ${new Date().toISOString()}" || echo "no changes"`, { cwd: ROOT_DIR });
  execSync('git push origin main', { cwd: ROOT_DIR });
  console.log('🚀 同步并推送到 GitHub 完成');
}

// === 执行主函数 ===
savePosts().catch(console.error);

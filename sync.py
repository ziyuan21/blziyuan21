import requests
import os
import yaml
import datetime
import re
import subprocess

# 配置
WP_API = "https://blziyuan21.com/wp-json/wp/v2/posts?per_page=10"
CATEGORY_API = "https://blziyuan21.com/wp-json/wp/v2/categories"
POST_DIR = "source/_posts"
AUTHOR = "WordPress Sync"
DELETE_OLD = True  # 设置为 True 表示会删除旧文章

def sanitize_filename(title):
    return re.sub(r'[\\/*?:"<>|]', "", title.replace(" ", "_"))

def get_categories_map():
    response = requests.get(CATEGORY_API)
    if response.ok:
        return {cat["id"]: cat["name"] for cat in response.json()}
    return {}

def fetch_posts():
    response = requests.get(WP_API)
    return response.json() if response.ok else []

def create_md(post, category_map):
    title = post["title"]["rendered"]
    date = post["date"]
    content = post["content"]["rendered"]
    slug = post["slug"]
    categories = [category_map.get(cid, "未分类") for cid in post["categories"]]
    filename = sanitize_filename(slug) + ".md"

    front_matter = {
        "title": title,
        "date": date,
        "categories": categories,
        "tags": [],
    }

    md_content = f"---\n{yaml.dump(front_matter, allow_unicode=True)}---\n{content}"
    filepath = os.path.join(POST_DIR, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"✅ 写入文章：{filename}")

def clean_old_posts():
    for file in os.listdir(POST_DIR):
        if file.endswith(".md"):
            path = os.path.join(POST_DIR, file)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            if AUTHOR in content or "WordPress Sync" in content:
                os.remove(path)
                print(f"🗑️ 删除旧文章：{file}")

def git_push():
    try:
        subprocess.run(["git", "add", "."], check=True)
        subprocess.run(["git", "commit", "-m", "同步 WordPress 最新文章"], check=True)
        subprocess.run(["git", "push"], check=True)
        print("🚀 推送到 GitHub 成功")
    except subprocess.CalledProcessError as e:
        print("❌ Git 操作失败", e)

def main():
    os.makedirs(POST_DIR, exist_ok=True)
    if DELETE_OLD:
        clean_old_posts()

    category_map = get_categories_map()
    posts = fetch_posts()

    for post in posts:
        if post["status"] != "publish":
            continue
        create_md(post, category_map)

    git_push()

if __name__ == "__main__":
    main()

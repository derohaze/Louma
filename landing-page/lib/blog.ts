import fs from 'node:fs/promises';
import path from 'node:path';

export interface BlogPost {
  slug: string;
  url: string;
  path: string;
  data: {
    title: string;
    description?: string;
    date?: string;
    author?: string;
    content: string;
  };
}

const blogDir = path.join(process.cwd(), 'content', 'blog');

function parseFrontmatter(source: string): BlogPost['data'] {
  if (!source.startsWith('---')) {
    return {
      title: 'Untitled',
      content: source,
    };
  }

  const end = source.indexOf('\n---', 3);
  if (end === -1) {
    return {
      title: 'Untitled',
      content: source,
    };
  }

  const raw = source.slice(3, end).trim();
  const content = source.slice(end + 4).trim();
  const data: BlogPost['data'] = {
    title: 'Untitled',
    content,
  };

  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');

    if (key === 'title') data.title = value;
    if (key === 'description') data.description = value;
    if (key === 'date') data.date = value;
    if (key === 'author') data.author = value;
  }

  return data;
}

export async function getBlogPosts(): Promise<BlogPost[]> {
  const entries = await fs.readdir(blogDir);
  const posts = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.mdx'))
      .map(async (entry) => {
        const fullPath = path.join(blogDir, entry);
        const source = await fs.readFile(fullPath, 'utf8');
        const slug = path.basename(entry, '.mdx');

        return {
          slug,
          url: `/blog/${slug}`,
          path: entry,
          data: parseFrontmatter(source),
        };
      }),
  );

  return posts.sort(
    (a, b) =>
      new Date(b.data.date ?? b.slug).getTime() - new Date(a.data.date ?? a.slug).getTime(),
  );
}

export async function getBlogPost(slug: string): Promise<BlogPost | undefined> {
  return (await getBlogPosts()).find((post) => post.slug === slug);
}

export function renderMarkdownLite(content: string): string {
  return content
    .replace(/^import .+$/gm, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

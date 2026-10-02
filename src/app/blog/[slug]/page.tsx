import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { query } from '@/lib/db';
import { sanitizeHtml } from '@/lib/sanitize-html';
import type { BlogPost } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getPost(slug: string): Promise<BlogPost | null> {
  const result = await query(
    `SELECT id, title_ar, title_en, slug, excerpt_ar, excerpt_en,
            content_ar, content_en, image_url, category,
            author_name, published_at, view_count, meta_title, meta_description
     FROM blog_posts
     WHERE slug = $1 AND status = 'published'`,
    [slug]
  );
  return result.rows[0] as BlogPost | null;
}

async function getRelatedPosts(category: string | null | undefined, excludeId: string): Promise<BlogPost[]> {
  if (!category) return [];
  const result = await query(
    `SELECT id, title_ar, slug, excerpt_ar, image_url, category, published_at
     FROM blog_posts
     WHERE category = $1 AND id != $2 AND status = 'published'
     ORDER BY published_at DESC
     LIMIT 3`,
    [category, excludeId]
  );
  return result.rows as BlogPost[];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    return { title: 'المقال غير موجود' };
  }

  return {
    title: post.meta_title || post.title_ar,
    description: post.meta_description || post.excerpt_ar || post.title_ar,
    openGraph: {
      title: post.title_ar,
      description: post.excerpt_ar || '',
      type: 'article',
      publishedTime: post.published_at || undefined,
      authors: post.author_name ? [post.author_name] : undefined,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    notFound();
  }

  const relatedPosts = await getRelatedPosts(post.category, post.id);

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <main className="min-h-screen bg-gray-50" id="main-content">
      {/* Hero Image */}
      {post.image_url && (
        <div className="relative h-[300px] md:h-[400px]">
          <Image
            src={post.image_url}
            alt={post.title_ar}
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        </div>
      )}

      <article className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <header className={post.image_url ? '-mt-20 relative z-10' : ''}>
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
            {post.category && (
              <Link
                href={`/blog?category=${post.category}`}
                className="inline-block px-3 py-1 bg-primary/10 text-primary text-sm font-medium rounded-full hover:bg-primary/20 transition-colors"
              >
                {post.category}
              </Link>
            )}

            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mt-4 mb-4">
              {post.title_ar}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-gray-500 text-sm">
              {post.author_name && (
                <span className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs">
                    {post.author_name.charAt(0)}
                  </span>
                  {post.author_name}
                </span>
              )}
              <span>{formatDate(post.published_at)}</span>
              <span>{post.view_count} مشاهدة</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="mt-8 bg-white rounded-2xl shadow-lg p-6 md:p-8">
          <div
            className="prose prose-lg max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-primary prose-strong:text-gray-900"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.content_ar) }}
          />

          {/* Share */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-gray-500 text-sm mb-3">شارك المقال:</p>
            <div className="flex gap-3">
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title_ar)}&url=${encodeURIComponent(`https://citymarkets.sa/blog/${post.slug}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-blue-400 text-white rounded-full flex items-center justify-center hover:bg-blue-500 transition-colors"
                aria-label="شارك على تويتر"
              >
                X
              </a>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(post.title_ar + ' ' + `https://citymarkets.sa/blog/${post.slug}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 transition-colors"
                aria-label="شارك على واتساب"
              >
                📱
              </a>
            </div>
          </div>
        </div>

        {/* Related Posts */}
        {relatedPosts.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">مقالات مشابهة</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {relatedPosts.map((related) => (
                <Link
                  key={related.id}
                  href={`/blog/${related.slug}`}
                  className="group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow"
                >
                  <div className="relative h-32">
                    {related.image_url ? (
                      <Image
                        src={related.image_url}
                        alt={related.title_ar}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gray-200" />
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-gray-900 line-clamp-2 group-hover:text-primary transition-colors">
                      {related.title_ar}
                    </h3>
                    <p className="text-gray-500 text-xs mt-2">{formatDate(related.published_at)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Back to Blog */}
        <div className="mt-8 text-center">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-primary hover:underline"
          >
            ← العودة للمدونة
          </Link>
        </div>
      </article>
    </main>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { query } from '@/lib/db';
import type { BlogPostList as BlogPost } from '@/lib/types';

export const metadata: Metadata = {
  title: 'المدونة - أسواق سيتي المركزية',
  description: 'نصائح للتسوق الصحي، وصفات، وعروض حصرية من أسواق سيتي المركزية',
  openGraph: {
    title: 'مدونة أسواق سيتي',
    description: 'نصائح للتسوق الصحي والوصفات والعروض',
    type: 'website',
  },
};

export const dynamic = 'force-dynamic';

async function getPosts() {
  const result = await query(
    `SELECT id, title_ar, slug, excerpt_ar, image_url, category, 
            author_name, published_at, is_featured
     FROM blog_posts
     WHERE status = 'published'
     ORDER BY is_featured DESC, published_at DESC
     LIMIT 20`
  );
  return result.rows as BlogPost[];
}

async function getFeaturedPost() {
  const result = await query(
    `SELECT id, title_ar, slug, excerpt_ar, image_url, category,
            author_name, published_at
     FROM blog_posts
     WHERE status = 'published' AND is_featured = TRUE
     ORDER BY published_at DESC
     LIMIT 1`
  );
  return result.rows[0] as BlogPost | null;
}

export default async function BlogPage() {
  const [posts, featuredPost] = await Promise.all([getPosts(), getFeaturedPost()]);

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
      {/* Hero */}
      <section className="bg-gradient-to-br from-[#009345] to-[#007A38] text-white py-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold mb-3">المدونة</h1>
          <p className="text-white/90 text-lg">نصائح، وصفات، وعروض حصرية</p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Featured Post */}
        {featuredPost && (
          <div className="mb-10">
            <Link href={`/blog/${featuredPost.slug}`} className="group">
              <div className="relative h-[300px] md:h-[400px] rounded-2xl overflow-hidden">
                {featuredPost.image_url ? (
                  <Image
                    src={featuredPost.image_url}
                    alt={featuredPost.title_ar}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-[#009345] to-[#007A38]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
                  <span className="inline-block px-3 py-1 bg-primary text-white text-sm rounded-full mb-3">
                    مقال مميز
                  </span>
                  <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
                    {featuredPost.title_ar}
                  </h2>
                  {featuredPost.excerpt_ar && (
                    <p className="text-white/80 text-sm md:text-base line-clamp-2">
                      {featuredPost.excerpt_ar}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-white/70 text-sm">
                    {featuredPost.author_name && <span>{featuredPost.author_name}</span>}
                    <span>{formatDate(featuredPost.published_at)}</span>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        )}

        {/* Posts Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts
            .filter((p) => !p.is_featured)
            .map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow"
              >
                <div className="relative h-48">
                  {post.image_url ? (
                    <Image
                      src={post.image_url}
                      alt={post.title_ar}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gray-200 flex items-center justify-center">
                      <span className="text-5xl">📝</span>
                    </div>
                  )}
                </div>
                <div className="p-5">
                  {post.category && (
                    <span className="text-xs text-primary font-medium">
                      {post.category}
                    </span>
                  )}
                  <h3 className="text-lg font-bold text-gray-900 mt-2 mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                    {post.title_ar}
                  </h3>
                  {post.excerpt_ar && (
                    <p className="text-gray-500 text-sm line-clamp-2 mb-3">
                      {post.excerpt_ar}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-gray-400 text-xs">
                    {post.author_name && <span>{post.author_name}</span>}
                    <span>{formatDate(post.published_at)}</span>
                  </div>
                </div>
              </Link>
            ))}
        </div>

        {posts.length === 0 && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📝</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">لا توجد مقالات</h2>
            <p className="text-gray-500">قريباً ستجد هنا مقالات مثيرة!</p>
          </div>
        )}
      </div>
    </main>
  );
}

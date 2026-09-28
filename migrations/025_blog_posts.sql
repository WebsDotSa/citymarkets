-- Migration: 025_blog_posts
-- Creates blog posts table for SEO content marketing

-- Blog posts table
CREATE TABLE IF NOT EXISTS blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_ar VARCHAR(255) NOT NULL,
    title_en VARCHAR(255),
    slug VARCHAR(255) UNIQUE NOT NULL,
    excerpt_ar TEXT,
    excerpt_en TEXT,
    content_ar TEXT NOT NULL,
    content_en TEXT,
    image_url VARCHAR(500),
    category VARCHAR(100),
    tags TEXT[], -- PostgreSQL array for tags
    author_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'draft', -- draft, published, archived
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    view_count INTEGER DEFAULT 0,
    meta_title VARCHAR(255),
    meta_description TEXT,
    is_featured BOOLEAN DEFAULT FALSE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_blog_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_published ON blog_posts(published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_blog_category ON blog_posts(category);
CREATE INDEX IF NOT EXISTS idx_blog_featured ON blog_posts(is_featured) WHERE is_featured = TRUE;

-- Full text search index
CREATE INDEX IF NOT EXISTS idx_blog_search_ar ON blog_posts USING gin(to_tsvector('arabic', title_ar || ' ' || COALESCE(content_ar, '')));
CREATE INDEX IF NOT EXISTS idx_blog_search_en ON blog_posts USING gin(to_tsvector('english', COALESCE(title_en, '') || ' ' || COALESCE(content_en, '')));

-- RLS
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Public read access for published posts
CREATE POLICY "Public read published blog posts" ON blog_posts
    FOR SELECT USING (status = 'published');

-- Admin full access
CREATE POLICY "Admin full access blog posts" ON blog_posts
    FOR ALL USING (true);

-- Seed some sample blog posts
INSERT INTO blog_posts (title_ar, slug, excerpt_ar, content_ar, category, status, published_at, author_name, is_featured)
VALUES 
    (
        'نصائح للتسوق الذكي في رمضان',
        'tips-smart-shopping-ramadan',
        'تعرف على أفضل النصائح للتسوق الذكي خلال شهر رمضان المبارك',
        '<h2>🌙 نصائح للتسوق الذكي في رمضان</h2>

<p>شهر رمضان المبارك هو شهر البركة والخيرات، وفيه تتغير عادات التسوق لدى كثير من الأسر السعودية. إليك أهم النصائح:</p>

<h3>1. خطة التسوق المسبقة</h3>
<p>قبل الذهاب للتسوق، ضع قائمة بالأشياء التي تحتاجها. هذا يساعدك على:</p>
<ul>
<li>توفير الوقت والجهد</li>
<li>تقليل المصاريف الزائدة</li>
<li>ضمان حصولك على كل ما تحتاجه</li>
</ul>

<h3>2. التسوق أونلاين</h3>
<p>في عصرنا الحالي، التسوق عبر الإنترنت يوفر عليك:</p>
<ul>
<li>تجنب الزحام</li>
<li>مقارنة الأسعار بسهولة</li>
<li>توصيل خلال ساعة</li>
</ul>

<h3>3. استفد من العروض</h3>
<p>لا تفوت العروض الخاصة برمضان على المنتجات الأساسية.</p>

<p>نحن في أسواق سيتي نقدم خصومات تصل إلى 30% على العديد من المنتجات خلال رمضان.</p>',
        'نصائح',
        'published',
        NOW() - INTERVAL '5 days',
        'فريق أسواق سيتي',
        TRUE
    ),
    (
        'فوائد الخضروات الطازجة',
        'benefits-fresh-vegetables',
        'تعرف على فوائد تناول الخضروات الطازجة يومياً',
        '<h2>🥬 فوائد الخضروات الطازجة</h2>

<p>الخضروات الطازجة هي أساس نظام غذائي صحي. إليك أهم فوائدها:</p>

<h3>1. غنية بالفيتامينات</h3>
<p>الخضروات تحتوي على فيتامينات A و C و K وغيرها من الفيتامينات الضرورية للجسم.</p>

<h3>2. مصدر للألياف</h3>
<p>الألياف مهمة لصحة الجهاز الهضمي وتساعد في الشعور بالشبع.</p>

<h3>3. قليلة السعرات الحرارية</h3>
<p>يمكنك تناول كميات كبيرة منها دون القلق من زيادة الوزن.</p>

<h3>4. تقوي المناعة</h3>
<p>مضادات الأكسدة في الخضروات تساعد في تقوية جهاز المناعة.</p>',
        'صحة',
        'published',
        NOW() - INTERVAL '10 days',
        'فريق أسواق سيتي',
        FALSE
    ),
    (
        'أفضل المنتجات السعودية المحلية',
        'best-saudi-local-products',
        'اكتشف أجود المنتجات السعودية المحلية',
        '<h2>🇸🇦 أفضل المنتجات السعودية المحلية</h2>

<p>المملكة العربية السعودية تزخر بمنتجات زراعية وغذائية عالية الجودة. إليك أفضلها:</p>

<h3>1. التمور</h3>
<p>تمر السكري والتمر العنزي من أشهر أنواع التمور السعودية.</p>

<h3>2. القهوة السعودية</h3>
<p>قهوة بلدي سعودية بطعم فريد ومميز.</p>

<h3>3. العسل السعودي</h3>
<p>عسل السدر والجبل من أجود أنواع العسل.</p>

<h3>4. منتجات الألبان</h3>
<p>حليب طازج وجبن محلي بجودة عالية.</p>',
        'منتجات',
        'published',
        NOW() - INTERVAL '15 days',
        'فريق أسواق سيتي',
        FALSE
    );

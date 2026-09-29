/**
 * Category groups for the public /categories landing page.
 *
 * Auto-generated from the DB at build/render time using parent_id relationships.
 * Root categories (parent_id IS NULL) become groups; their direct children
 * (parent_id = root.id) are the sub-category chips under each carousel.
 *
 * Falls back to a static CATEGORY_GROUPS list from category-groups.json
 * (which uses hard-coded slug arrays for backward compatibility with the
 * legacy data that lived before parent_id was introduced).
 */

import type { CategoryRow } from "@/lib/types";

export interface DynamicCategoryGroup {
  id: string;
  title: string;
  emoji: string;
  rootCategory: CategoryRow;
  children: CategoryRow[];
  isDynamic: true;
}

/** Emoji heuristics based on category name (Arabic). */
export function emojiForCategoryName(name: string): string {
  const n = name.trim();
  if (/(ألبان|جبنة|زبادي|حليب|قشطة|لبنة|سمن|زبدة)/i.test(n)) return "🥛";
  if (/(مقاضي|أرز|سكر|ملح|صلصة|صوص|بهارات|زيت|معكرونة|مكسرات|تونة|معجون|شعيرية|شوربة|فطر|مرتديلا|خردل|مايونيز|أغذية|معلبات|عصير|صلصات|شاي|قهوة|حليب بودرة)/i.test(n))
    return "🛒";
  if (/(مشروب|عصير|مياه|شاي|قهوة|كولا|صودا|طاقة|بيرة|شمبانيا|كاكاو|نسكافيه)/i.test(n))
    return "🥤";
  if (/(مخبوز|خبز|كرواسون|توست|صامولي|كيك|كعك|بسكويت|معمول|فطير|كب كيك|كبكية)/i.test(n))
    return "🍞";
  if (/(سناك|شوكولا|شوكولاتة|حلوى|chips|شيبس|بسكوت|علك|مكسرات|فشار|بونبون|كاكاو|بسكويت|كوكيز|نوجا|كستر|توفي|كيك|تشيز|كريب|حلاوة|طحينية|بسبوسة|لقيمات|كنافة|جاتو|دونات|وافل|كريب)/i.test(n))
    return "🍫";
  if (/(لحوم|دجاج|لحم|سمك|روبيان|مأكولات بحر|كباب|برجر|شاورما|ستيك|كفتة|نقانق|مرتديلا|لانشون|كبدة|هامبرغر|هامبرجر)/i.test(n))
    return "🍗";
  if (/(خضار|فواكه|فاكهة|فواكة|طماطم|خيار|بصل|ثوم|بطاطس|ليمون|تفاح|برتقال|موز|عنب|بطيخ|شمام|خوخ|مانجو|تمر|رمان|تين|زيتون|كمثرى|فراولة|كرز|خس|جرجير|نعناع|بقدونس|كزبرة|سبانخ|ملوخية|بامية|كوسة|باذنجان|فلفل|جزر|بنجر|فجل|قرنبيط|بروكلي|ملفوف|قرع|خبيزة|سلطة|خبيزة|جرجير)/i.test(n))
    return "🥬";
  if (/(مجمدة|مجمد|آيس كريم|مثلجات|بسكويت|بوظة|زبادي|فواكه مجمدة|خضار مجمدة|دجاج مجمد|سمك مجمد|لحم مجمد|نودلز)/i.test(n))
    return "❄️";
  if (/(تنظيف|منظف|غسيل|صابون|كلوركس|ديتول|مسحوق|سائل|مناديل|فوط|أكياس|أدوات تنظيف|فرشاة|إسفنجة|ليف|معطر|جو|مبيد|حشرات|شموع|ملمع|زجاج|أرضيات|سجاد|كنب|مرحاض|حمام|مطبخ|أواني|أكواب|صحون|ملاعق|شوك|سكاكين|قدور|صواني|أوعية|علب|كاسات|كاسات|أباريق|أدوات طهي|أدوات خبز)/i.test(n))
    return "🧹";
  if (/(شخصية|شعر|بشرة|جسم|عناية|صابون|شامبو|بلسم|كريم|لوشن|سيروم|تونر|منظف|غسول|مقشر|ماسك|أحمر شفاه|مكياج|كحل|ماسكرا|عطر|بخور|مزيل عرق|حلاقة|ماكين حلاقة|شفرات|فرشاة أسنان|معجون|غسول فم|خيط|منديل|حفائض|فوط صحية|واقي شمس|سلفر|ديتول|كحول|مرطب|مرطبات|أحمر خدود|بودرة|كحل|ظلال|كونسيلر|فايب|فتل|كفر|سماعات|شواحن)/i.test(n))
    return "💆";
  if (/(منزل|مفروشات|أثاث|سجاد|ستائر|وسائد|بطانيات|مناشف|أغطية|ملايات|مراتب|إضاءة|ثريات|أباجورة|ساعة|حائط|ديكور|لوحات|إطارات|مرايا|صحن|حائط|رفوف|خزائن|أدراج|صناديق|سلال|منظفات أدوات|بطاريات|شموع|أعياد ميلاد|ديكورات)/i.test(n))
    return "🏠";
  if (/(طفل|أطفال|رضيع|ببي|بيبي|حليب أطفال|حفائض|مناديل أطفال|شامبو أطفال|لهاية|زجاجة رضاعة|ألعاب|سيارة أطفال|سرير أطفال|كرسي أطفال|مقعد سيارة|كتب أطفال|ملابس أطفال|أحذية أطفال|شنطة مدرسة|قرطاسية)/i.test(n))
    return "👶";
  if (/(قهوة|شاي|كاكاو|نسكافيه|كابتشينو|إسبريسو|لاتيه|موكا|هوت شوكليت|شاي أخضر|شاي أسود|شاي أعشاب|شاي نعناع|شاي بابونج|كرك|زنجبيل|هيل|قرفة|يانسون|بابونج|زنجبيل)/i.test(n))
    return "☕";
  return "🛍️";
}

/**
 * Build dynamic groups from a flat list of categories.
 * Returns root categories with their direct children.
 */
export function buildDynamicGroups(
  categories: CategoryRow[]
): DynamicCategoryGroup[] {
  const roots = categories.filter((c) => !c.parent_id);
  const childrenByParent = new Map<string, CategoryRow[]>();
  for (const c of categories) {
    if (c.parent_id) {
      const k = String(c.parent_id);
      if (!childrenByParent.has(k)) childrenByParent.set(k, []);
      childrenByParent.get(k)!.push(c);
    }
  }

  return roots
    .filter((r) => r.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((root) => ({
      id: `dyn-${root.id}`,
      title: root.name_ar,
      emoji: emojiForCategoryName(root.name_ar),
      rootCategory: root,
      children: childrenByParent.get(String(root.id)) ?? [],
      isDynamic: true,
    }));
}
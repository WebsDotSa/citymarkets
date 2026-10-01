"use client";

/**
 * Section editor — renders a form tailored to the section's `type`.
 *
 * Driven by the `defaultValue` prop + `onChange` callback. The parent
 * owns the section list and persists changes when the user clicks
 * "حفظ القسم" in the drawer.
 */
import { useState } from "react";
import { ImageUploader } from "@/components/admin/image-uploader";
import { SearchableSelect } from "@/components/admin/SearchableSelect";
import { Button } from "@/components/design/button";
import { Plus, X } from "lucide-react";
import type {
  BannersSettings,
  CategoriesSettings,
  CategorySectionSettings,
  CtaSettings,
  CouponsSettings,
  HeroBannerSettings,
  HtmlBlockSettings,
  InlineBannerItem,
  LightningDealsSettings,
  OffersGridSettings,
  OffersStripSettings,
  ProductsSettings,
  Section,
  SectionType,
  StoresSettings,
} from '@/lib/catalog';

interface SectionEditorProps {
  section: Section;
  onChange: (next: Section) => void;
}

export function SectionEditor({ section, onChange }: SectionEditorProps) {
  // Local edits stay here until the parent calls `onChange`. Avoids
  // re-rendering the whole list on every keystroke.
  const [local, setLocal] = useState<Section>(section);

  const update = (patch: Partial<Section["settings"]>) => {
    const next = {
      ...local,
      settings: { ...local.settings, ...patch },
    } as Section;
    setLocal(next);
    onChange(next);
  };

  const updateRaw = (next: Section) => {
    setLocal(next);
    onChange(next);
  };

  switch (local.type) {
    case "hero_banner":
      return <HeroBannerForm settings={local.settings} onChange={(s) => update(s)} />;
    case "banners":
      return <BannersForm settings={local.settings} onChange={(s) => update(s)} />;
    case "categories":
      return <CategoriesForm settings={local.settings} onChange={(s) => update(s)} />;
    case "products":
      return <ProductsForm settings={local.settings} onChange={(s) => update(s)} />;
    case "offers_grid":
      return <OffersGridForm settings={local.settings} onChange={(s) => update(s)} />;
    case "offers_strip":
      return <OffersStripForm settings={local.settings} onChange={(s) => update(s)} />;
    case "lightning_deals":
      return <LightningDealsForm settings={local.settings} onChange={(s) => update(s)} />;
    case "category_section":
      return <CategorySectionForm settings={local.settings} onChange={(s) => update(s)} />;
    case "stores":
      return <StoresForm settings={local.settings} onChange={(s) => update(s)} />;
    case "coupons":
      return <CouponsForm settings={local.settings} onChange={(s) => update(s)} />;
    case "html_block":
      return <HtmlBlockForm settings={local.settings} onChange={(s) => update(s)} />;
    case "cta":
      return <CtaForm settings={local.settings} onChange={(s) => update(s)} />;
    default: {
      const _exhaustive: never = local;
      void _exhaustive;
      return null;
    }
  }
}

// ─── shared primitives ──────────────────────────────────────────

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {children}
      {hint && <span className="block text-xs text-gray-400 mt-0.5">{hint}</span>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "datetime-local" | "url" | "color";
}) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
    />
  );
}

function ColorInput({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 border border-gray-200 rounded-lg cursor-pointer"
      />
      <TextInput value={value ?? ""} onChange={onChange} placeholder="#RRGGBB" />
    </div>
  );
}

function ToggleInput({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer py-2">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-11 h-6 bg-gray-200 rounded-full peer-checked:bg-primary transition-colors" />
        <div className="absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full shadow-sm peer-checked:translate-x-5 transition-transform" />
      </div>
      <div>
        <p className="text-sm font-medium text-secondary">{label}</p>
        {description && <p className="text-xs text-gray-400">{description}</p>}
      </div>
    </label>
  );
}

// ─── per-type forms ─────────────────────────────────────────────

function HeroBannerForm({
  settings,
  onChange,
}: {
  settings: HeroBannerSettings;
  onChange: (s: Partial<HeroBannerSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <FieldLabel hint="يظهر في أعلى الصفحة الرئيسية">العنوان</FieldLabel>
      <TextInput value={settings.title_ar ?? ""} onChange={(v) => onChange({ title_ar: v })} />
      <FieldLabel>العنوان الفرعي</FieldLabel>
      <TextInput value={settings.subtitle_ar ?? ""} onChange={(v) => onChange({ subtitle_ar: v })} />
      <FieldLabel>صورة البانر</FieldLabel>
      <ImageUploader
        value={settings.image_url ?? ""}
        onChange={(v) => onChange({ image_url: v })}
        folder="home_hero"
      />
      <div className="grid grid-cols-2 gap-3">
        <ToggleInput
          checked={settings.show_search ?? true}
          onChange={(v) => onChange({ show_search: v })}
          label="إظهار البحث"
        />
        <ToggleInput
          checked={settings.show_location ?? true}
          onChange={(v) => onChange({ show_location: v })}
          label="إظهار الموقع"
        />
      </div>
      <FieldLabel>لون الخلفية</FieldLabel>
      <ColorInput value={settings.background_color} onChange={(v) => onChange({ background_color: v })} />
    </div>
  );
}

function BannerItemEditor({
  item,
  onChange,
  onRemove,
}: {
  item: InlineBannerItem;
  onChange: (next: InlineBannerItem) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">بانر</p>
        <button
          type="button"
          onClick={onRemove}
          className="text-red-500 hover:bg-red-50 rounded p-1"
          aria-label="حذف البانر"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <FieldLabel>صورة البانر</FieldLabel>
      <ImageUploader
        value={item.image_url ?? ""}
        onChange={(v) => onChange({ ...item, image_url: v })}
        folder="home_banners"
      />
      <FieldLabel>عنوان البانر</FieldLabel>
      <TextInput
        value={item.title_ar ?? ""}
        onChange={(v) => onChange({ ...item, title_ar: v })}
      />
      <FieldLabel>عنوان فرعي</FieldLabel>
      <TextInput
        value={item.subtitle_ar ?? ""}
        onChange={(v) => onChange({ ...item, subtitle_ar: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>نوع الرابط</FieldLabel>
          <SearchableSelect
            value={item.link_type}
            onChange={(v) => onChange({ ...item, link_type: v as InlineBannerItem["link_type"] })}
            options={[
              { value: "none", label: "بدون" },
              { value: "category", label: "فئة" },
              { value: "product", label: "منتج" },
              { value: "vendor", label: "متجر" },
              { value: "external", label: "خارجي" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
        <div>
          <FieldLabel>قيمة الرابط</FieldLabel>
          <TextInput
            value={item.link_value ?? ""}
            onChange={(v) => onChange({ ...item, link_value: v })}
            placeholder={
              item.link_type === "category"
                ? "slug الفئة"
                : item.link_type === "product"
                ? "معرف المنتج"
                : item.link_type === "vendor"
                ? "slug المتجر"
                : "https://..."
            }
          />
        </div>
      </div>
      {item.ends_at !== undefined && (
        <div>
          <FieldLabel hint="يظهر كعداد إذا مفعّل في القسم">وقت الانتهاء (ISO)</FieldLabel>
          <TextInput
            value={item.ends_at ?? ""}
            type="datetime-local"
            onChange={(v) => onChange({ ...item, ends_at: v ? new Date(v).toISOString() : null })}
          />
        </div>
      )}
    </div>
  );
}

function BannersForm({
  settings,
  onChange,
}: {
  settings: BannersSettings;
  onChange: (s: Partial<BannersSettings>) => void;
}) {
  const updateBanner = (idx: number, next: InlineBannerItem) => {
    const list = [...settings.banners];
    list[idx] = next;
    onChange({ banners: list });
  };
  const addBanner = () => {
    onChange({
      banners: [
        ...settings.banners,
        { id: `b-${Date.now()}`, image_url: "", link_type: "none" },
      ],
    });
  };
  const removeBanner = (idx: number) => {
    onChange({ banners: settings.banners.filter((_, i) => i !== idx) });
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>نمط العرض</FieldLabel>
          <SearchableSelect
            value={settings.layout}
            onChange={(v) => onChange({ layout: v as BannersSettings["layout"] })}
            options={[
              { value: "carousel", label: "كاروسيل (carousel)" },
              { value: "grid_2", label: "شبكة عمودين" },
              { value: "grid_3", label: "شبكة 3 أعمدة" },
              { value: "tall", label: "طويل (tall)" },
              { value: "wide", label: "عريض (wide)" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
        <div>
          <FieldLabel>النسبة (aspect)</FieldLabel>
          <TextInput
            value={settings.aspect_ratio ?? "16/9"}
            onChange={(v) => onChange({ aspect_ratio: v })}
            placeholder="16/9"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ToggleInput
          checked={settings.auto_play ?? true}
          onChange={(v) => onChange({ auto_play: v })}
          label="تشغيل تلقائي"
        />
        <ToggleInput
          checked={settings.show_dots ?? true}
          onChange={(v) => onChange({ show_dots: v })}
          label="إظهار النقاط"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">البنرات ({settings.banners.length})</p>
          <Button type="button" variant="outline" size="sm" onClick={addBanner}>
            <Plus className="w-4 h-4 ms-1" />
            إضافة بانر
          </Button>
        </div>
        <div className="space-y-3 max-h-96 overflow-y-auto pe-1">
          {settings.banners.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">
              لا توجد بنرات بعد. أضف واحداً للبدء.
            </p>
          )}
          {settings.banners.map((b, i) => (
            <BannerItemEditor
              key={b.id ?? i}
              item={b}
              onChange={(next) => updateBanner(i, next)}
              onRemove={() => removeBanner(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoriesForm({
  settings,
  onChange,
}: {
  settings: CategoriesSettings;
  onChange: (s: Partial<CategoriesSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <FieldLabel>العنوان</FieldLabel>
      <TextInput value={settings.title ?? ""} onChange={(v) => onChange({ title: v })} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>عدد الأعمدة (3-8)</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.columns)}
            onChange={(v) => onChange({ columns: parseInt(v) || 4 })}
          />
        </div>
        <div>
          <FieldLabel>الحد الأقصى للعناصر</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.max_items ?? 8)}
            onChange={(v) => onChange({ max_items: parseInt(v) || 8 })}
          />
        </div>
      </div>
      <ToggleInput
        checked={settings.root_only ?? true}
        onChange={(v) => onChange({ root_only: v })}
        label="الفئات الرئيسية فقط"
      />
      <ToggleInput
        checked={settings.show_icons ?? true}
        onChange={(v) => onChange({ show_icons: v })}
        label="إظهار الأيقونات"
      />
      <FieldLabel>لون الخلفية</FieldLabel>
      <ColorInput value={settings.background_color} onChange={(v) => onChange({ background_color: v })} />
    </div>
  );
}

function ProductsForm({
  settings,
  onChange,
}: {
  settings: ProductsSettings;
  onChange: (s: Partial<ProductsSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <FieldLabel>العنوان</FieldLabel>
      <TextInput value={settings.title} onChange={(v) => onChange({ title: v })} />
      <FieldLabel>العنوان الفرعي</FieldLabel>
      <TextInput value={settings.subtitle ?? ""} onChange={(v) => onChange({ subtitle: v })} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>المصدر</FieldLabel>
          <SearchableSelect
            value={settings.source}
            onChange={(v) => onChange({ source: v as ProductsSettings["source"] })}
            options={[
              { value: "featured", label: "مميزة" },
              { value: "best_selling", label: "الأكثر مبيعاً" },
              { value: "on_offer", label: "عروض" },
              { value: "new", label: "جديدة" },
              { value: "custom", label: "مخصصة" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
        <div>
          <FieldLabel>الحد الأقصى</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.limit)}
            onChange={(v) => onChange({ limit: parseInt(v) || 8 })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>نمط العرض</FieldLabel>
          <SearchableSelect
            value={settings.display}
            onChange={(v) => onChange({ display: v as ProductsSettings["display"] })}
            options={[
              { value: "carousel", label: "كاروسيل أفقي" },
              { value: "grid", label: "شبكة" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
        <div>
          <FieldLabel>عدد الأعمدة (لشبكة)</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.columns ?? 4)}
            onChange={(v) => onChange({ columns: parseInt(v) || 4 })}
          />
        </div>
      </div>
      {settings.source === "custom" && (
        <FieldLabel hint="معرفات المنتجات مفصولة بفواصل">معرفات المنتجات (IDs)</FieldLabel>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>نص زر "عرض الكل"</FieldLabel>
          <TextInput value={settings.cta_text ?? ""} onChange={(v) => onChange({ cta_text: v })} />
        </div>
        <div>
          <FieldLabel>رابط زر "عرض الكل"</FieldLabel>
          <TextInput value={settings.cta_link ?? ""} onChange={(v) => onChange({ cta_link: v })} />
        </div>
      </div>
      <FieldLabel>لون الخلفية</FieldLabel>
      <ColorInput value={settings.background_color} onChange={(v) => onChange({ background_color: v })} />
      <ToggleInput
        checked={settings.show_prices ?? true}
        onChange={(v) => onChange({ show_prices: v })}
        label="إظهار الأسعار"
      />
    </div>
  );
}

function OffersGridForm({
  settings,
  onChange,
}: {
  settings: OffersGridSettings;
  onChange: (s: Partial<OffersGridSettings>) => void;
}) {
  // Same shape as ProductsForm but with a fixed source.
  return (
    <ProductsForm
      settings={{
        ...settings,
        source: "featured",
      }}
      onChange={(s) => onChange(s as Partial<OffersGridSettings>)}
    />
  );
}

function OffersStripForm({
  settings,
  onChange,
}: {
  settings: OffersStripSettings;
  onChange: (s: Partial<OffersStripSettings>) => void;
}) {
  const updateBanner = (idx: number, next: InlineBannerItem) => {
    const list = [...settings.banners];
    list[idx] = { ...next, ends_at: next.ends_at ?? new Date(Date.now() + 86400_000).toISOString() };
    onChange({ banners: list });
  };
  const addBanner = () => {
    onChange({
      banners: [
        ...settings.banners,
        {
          id: `os-${Date.now()}`,
          image_url: "",
          link_type: "none",
          ends_at: new Date(Date.now() + 86400_000).toISOString(),
          discount_label: "-30%",
        },
      ],
    });
  };
  const removeBanner = (idx: number) => {
    onChange({ banners: settings.banners.filter((_, i) => i !== idx) });
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>العنوان</FieldLabel>
          <TextInput value={settings.title} onChange={(v) => onChange({ title: v })} />
        </div>
        <div>
          <FieldLabel>العنوان الفرعي</FieldLabel>
          <TextInput value={settings.subtitle ?? ""} onChange={(v) => onChange({ subtitle: v })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>لون الخلفية</FieldLabel>
          <ColorInput value={settings.background_color} onChange={(v) => onChange({ background_color: v })} />
        </div>
        <div>
          <FieldLabel>لون النص</FieldLabel>
          <ColorInput value={settings.text_color} onChange={(v) => onChange({ text_color: v })} />
        </div>
      </div>
      <ToggleInput
        checked={settings.countdown_enabled ?? true}
        onChange={(v) => onChange({ countdown_enabled: v })}
        label="إظهار العداد"
        description="يظهر على كل بانر فيه وقت انتهاء"
      />
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">بنرات العروض ({settings.banners.length})</p>
          <Button type="button" variant="outline" size="sm" onClick={addBanner}>
            <Plus className="w-4 h-4 ms-1" />
            إضافة بانر عرض
          </Button>
        </div>
        <div className="space-y-3 max-h-96 overflow-y-auto pe-1">
          {settings.banners.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">
              لا توجد بنرات عروض بعد.
            </p>
          )}
          {settings.banners.map((b, i) => (
            <BannerItemEditor
              key={b.id ?? i}
              item={b}
              onChange={(next) => updateBanner(i, next)}
              onRemove={() => removeBanner(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LightningDealsForm({
  settings,
  onChange,
}: {
  settings: LightningDealsSettings;
  onChange: (s: Partial<LightningDealsSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>العنوان</FieldLabel>
          <TextInput value={settings.title} onChange={(v) => onChange({ title: v })} />
        </div>
        <div>
          <FieldLabel>العنوان الفرعي</FieldLabel>
          <TextInput value={settings.subtitle ?? ""} onChange={(v) => onChange({ subtitle: v })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>لون الخلفية</FieldLabel>
          <ColorInput value={settings.background_color} onChange={(v) => onChange({ background_color: v })} />
        </div>
        <div>
          <FieldLabel>لون الهيدر</FieldLabel>
          <ColorInput value={settings.header_color} onChange={(v) => onChange({ header_color: v })} />
        </div>
      </div>
      <FieldLabel>لون الحدود</FieldLabel>
      <ColorInput value={settings.border_color} onChange={(v) => onChange({ border_color: v })} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>مصدر المنتجات</FieldLabel>
          <SearchableSelect
            value={settings.product_source}
            onChange={(v) =>
              onChange({ product_source: v as LightningDealsSettings["product_source"] })
            }
            options={[
              { value: "on_offer", label: "منتجات عليها عرض" },
              { value: "custom", label: "مخصصة (IDs)" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
        <div>
          <FieldLabel>الحد الأقصى</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.limit ?? 6)}
            onChange={(v) => onChange({ limit: parseInt(v) || 6 })}
          />
        </div>
      </div>
      <FieldLabel hint="يظهر كعداد في القسم">وقت الانتهاء</FieldLabel>
      <TextInput
        type="datetime-local"
        value={
          settings.ends_at
            ? new Date(settings.ends_at).toISOString().slice(0, 16)
            : ""
        }
        onChange={(v) =>
          onChange({ ends_at: v ? new Date(v).toISOString() : new Date().toISOString() })
        }
      />
      <ToggleInput
        checked={settings.show_countdown ?? true}
        onChange={(v) => onChange({ show_countdown: v })}
        label="إظهار العداد"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>نص الفوتر</FieldLabel>
          <TextInput value={settings.footer_text ?? ""} onChange={(v) => onChange({ footer_text: v })} />
        </div>
        <div>
          <FieldLabel>رابط الفوتر</FieldLabel>
          <TextInput value={settings.footer_link ?? ""} onChange={(v) => onChange({ footer_link: v })} />
        </div>
      </div>
    </div>
  );
}

function CategorySectionForm({
  settings,
  onChange,
}: {
  settings: CategorySectionSettings;
  onChange: (s: Partial<CategorySectionSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <FieldLabel hint="معرف الفئة UUID">معرف الفئة</FieldLabel>
      <TextInput value={settings.category_id} onChange={(v) => onChange({ category_id: v })} />
      <FieldLabel>عنوان مخصص (اختياري)</FieldLabel>
      <TextInput
        value={settings.title_override ?? ""}
        onChange={(v) => onChange({ title_override: v })}
      />
      <FieldLabel>عنوان فرعي مخصص</FieldLabel>
      <TextInput
        value={settings.subtitle_override ?? ""}
        onChange={(v) => onChange({ subtitle_override: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>نمط العرض</FieldLabel>
          <SearchableSelect
            value={settings.layout}
            onChange={(v) => onChange({ layout: v as CategorySectionSettings["layout"] })}
            options={[
              { value: "grid", label: "شبكة" },
              { value: "list", label: "قائمة" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
        <div>
          <FieldLabel>الحد الأقصى</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.limit ?? 8)}
            onChange={(v) => onChange({ limit: parseInt(v) || 8 })}
          />
        </div>
      </div>
      <FieldLabel>لون الخلفية</FieldLabel>
      <ColorInput value={settings.background_color} onChange={(v) => onChange({ background_color: v })} />
      <ToggleInput
        checked={settings.show_prices ?? true}
        onChange={(v) => onChange({ show_prices: v })}
        label="إظهار الأسعار"
      />
    </div>
  );
}

function StoresForm({
  settings,
  onChange,
}: {
  settings: StoresSettings;
  onChange: (s: Partial<StoresSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>العنوان</FieldLabel>
          <TextInput value={settings.title} onChange={(v) => onChange({ title: v })} />
        </div>
        <div>
          <FieldLabel>العنوان الفرعي</FieldLabel>
          <TextInput value={settings.subtitle ?? ""} onChange={(v) => onChange({ subtitle: v })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>الحد الأقصى</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.limit ?? 8)}
            onChange={(v) => onChange({ limit: parseInt(v) || 8 })}
          />
        </div>
        <div>
          <FieldLabel>نمط العرض</FieldLabel>
          <SearchableSelect
            value={settings.display}
            onChange={(v) => onChange({ display: v as StoresSettings["display"] })}
            options={[
              { value: "carousel", label: "كاروسيل" },
              { value: "grid", label: "شبكة" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
      </div>
      <ToggleInput
        checked={settings.featured_only ?? true}
        onChange={(v) => onChange({ featured_only: v })}
        label="المتاجر المميزة فقط"
      />
    </div>
  );
}

function CouponsForm({
  settings,
  onChange,
}: {
  settings: CouponsSettings;
  onChange: (s: Partial<CouponsSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <FieldLabel>العنوان (اختياري)</FieldLabel>
      <TextInput value={settings.title ?? ""} onChange={(v) => onChange({ title: v })} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>الحد الأقصى</FieldLabel>
          <TextInput
            type="number"
            value={String(settings.limit ?? 6)}
            onChange={(v) => onChange({ limit: parseInt(v) || 6 })}
          />
        </div>
        <div>
          <FieldLabel>نمط العرض</FieldLabel>
          <SearchableSelect
            value={settings.display}
            onChange={(v) => onChange({ display: v as CouponsSettings["display"] })}
            options={[
              { value: "strip", label: "شريط أفقي" },
              { value: "grid", label: "شبكة" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
      </div>
    </div>
  );
}

function HtmlBlockForm({
  settings,
  onChange,
}: {
  settings: HtmlBlockSettings;
  onChange: (s: Partial<HtmlBlockSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <FieldLabel hint="HTML مسموح. يتم حذف وسوم <script> تلقائياً عند العرض.">المحتوى</FieldLabel>
      <textarea
        value={settings.content_html ?? ""}
        onChange={(e) => onChange({ content_html: e.target.value })}
        rows={6}
        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>لون الخلفية</FieldLabel>
          <ColorInput value={settings.background_color} onChange={(v) => onChange({ background_color: v })} />
        </div>
        <div>
          <FieldLabel>لون النص</FieldLabel>
          <ColorInput value={settings.text_color} onChange={(v) => onChange({ text_color: v })} />
        </div>
      </div>
    </div>
  );
}

function CtaForm({
  settings,
  onChange,
}: {
  settings: CtaSettings;
  onChange: (s: Partial<CtaSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>النوع</FieldLabel>
          <SearchableSelect
            value={settings.variant}
            onChange={(v) => onChange({ variant: v as CtaSettings["variant"] })}
            options={[
              { value: "join", label: "تسجيل/انضمام عميل" },
              { value: "partner", label: "كن شريكاً (متجر)" },
            ]}
            includePlaceholderOption={false}
            searchable={false}
            allowClear={false}
          />
        </div>
      </div>
      <FieldLabel>العنوان</FieldLabel>
      <TextInput value={settings.title ?? ""} onChange={(v) => onChange({ title: v })} />
      <FieldLabel>العنوان الفرعي</FieldLabel>
      <TextInput value={settings.subtitle ?? ""} onChange={(v) => onChange({ subtitle: v })} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>نص الزر</FieldLabel>
          <TextInput value={settings.cta_text ?? ""} onChange={(v) => onChange({ cta_text: v })} />
        </div>
        <div>
          <FieldLabel>رابط الزر</FieldLabel>
          <TextInput value={settings.cta_href ?? ""} onChange={(v) => onChange({ cta_href: v })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>لون الخلفية</FieldLabel>
          <ColorInput value={settings.background_color} onChange={(v) => onChange({ background_color: v })} />
        </div>
        <div>
          <FieldLabel>لون النص</FieldLabel>
          <ColorInput value={settings.text_color} onChange={(v) => onChange({ text_color: v })} />
        </div>
      </div>
    </div>
  );
}
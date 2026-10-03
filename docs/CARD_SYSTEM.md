# 🎴 Unified Card System

**Status**: ✅ Documented Card Taxonomy  
**Version**: 1.0  
**Date**: 2026-10-03

---

## 📋 Overview

Unified guidelines for card components across the application. Establishes when to use each card type and consolidates patterns.

---

## 🎯 Card Types

### 1️⃣ Base Card (`/ui/card.tsx`)

**Purpose**: Generic card wrapper for any content

**Features**:
- Flexible padding (sm/md/lg)
- Radius options
- Shadow options
- No semantic content assumptions

**When to use**:
- Generic content containers
- Layouts that don't fit other card types
- Custom card implementations

**Example**:
```tsx
import { Card } from "@/components/ui/card";

<Card padding="md" radius="lg" shadow="soft">
  <p>Custom content</p>
</Card>
```

---

### 2️⃣ Admin Section (`/admin/admin-section.tsx`)

**Purpose**: Admin panel content sections

**Features**:
- Title and description
- Header action slot
- Flexible padding
- Clean header/content separation

**When to use**:
- Admin dashboard sections
- Settings pages
- Data tables with headers
- Form sections in admin

**Example**:
```tsx
import { AdminSection } from "@/components/admin";

<AdminSection
  title="User Settings"
  description="Manage user preferences"
  headerAction={<AdminButton>Edit</AdminButton>}
>
  <AdminInput label="Email" />
</AdminSection>
```

---

### 3️⃣ Admin Card (Legacy - `admin-card.tsx`)

**Status**: Deprecated in favor of AdminSection

**Migration**:
```tsx
// Before
<AdminCard title="Settings">
  Content
</AdminCard>

// After
<AdminSection title="Settings">
  Content
</AdminSection>
```

---

### 4️⃣ Vendor Card (`/ui/vendor-card.tsx`)

**Purpose**: Display vendor information in multiple layouts

**Variants**:
- `grid` - Card grid layout
- `list` - List item layout
- `hero` - Large hero card
- `featured` - Highlighted/featured card

**When to use**:
- Vendor listing pages
- Vendor search results
- Vendor recommendations
- Featured vendors

**Example**:
```tsx
import { VendorCard } from "@/components/ui/vendor-card";

<VendorCard
  variant="grid"
  vendor={vendorData}
  onClick={() => navigate(`/vendors/${vendor.slug}`)}
/>
```

---

### 5️⃣ Category Card (`/design/category-card.tsx`)

**Purpose**: Display category with emoji/icon

**Features**:
- Emoji/icon support
- Name and count
- Multiple size variants
- Consistent styling

**When to use**:
- Category browsing
- Category filters
- Category showcase

**Example**:
```tsx
import { CategoryCard } from "@/components/design/category-card";

<CategoryCard
  name="Groceries"
  emoji="🛒"
  count={1234}
/>
```

---

### 6️⃣ Offer Card (`/storefront/offer-card.tsx`)

**Purpose**: Display promotional offers

**Features**:
- Discount percentage
- Expiry date
- CTA button
- Promotional styling

**When to use**:
- Promotion listing
- Special offers page
- Discount highlights

**Example**:
```tsx
import { OfferCard } from "@/components/storefront/offer-card";

<OfferCard
  title="Summer Sale"
  discount="30%"
  expiresAt={new Date()}
  onClaim={() => {}}
/>
```

---

## 📐 Card Dimensions

| Card Type | Width | Height | Use Case |
|-----------|-------|--------|----------|
| Base | Full | Auto | Content-dependent |
| Admin Section | Full | Auto | Dashboard sections |
| Vendor | 240-280px (grid) | Auto | Grid layout |
| Category | 120-150px | 150px | Grid layout |
| Offer | 240-280px | 200px | Grid layout |

---

## 🎨 Styling Consistency

### Padding
```
sm: 12px
md: 16px (default)
lg: 24px
```

### Border Radius
```
Cards default: rounded-lg (12px)
```

### Shadows
```
Default: shadow-sm
Hover: shadow-md
```

### Backgrounds
```
White background: bg-white
Border: border border-gray-200
```

---

## 🔄 Migration Path

### From scattered card implementations

```tsx
// Before - Multiple implementations
<div className="bg-white p-4 rounded-lg border shadow-sm">
  Card content
</div>

// After - Use appropriate card type
<Card padding="md">
  Card content
</Card>
```

### From AdminCard to AdminSection

```tsx
// Before
<AdminCard title="Settings" subtitle="Update preferences">
  <AdminInput label="Name" />
</AdminCard>

// After
<AdminSection title="Settings" description="Update preferences">
  <AdminInput label="Name" />
</AdminSection>
```

---

## 📱 Responsive Design

All cards are responsive:

```tsx
// Mobile: 100% width
// Tablet: 48% width (grid of 2)
// Desktop: 25% width (grid of 4)

<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
  {cards.map(card => <VendorCard key={card.id} {...card} />)}
</div>
```

---

## ♿ Accessibility

### All Cards
- ✅ Semantic HTML (article, section)
- ✅ Proper heading hierarchy
- ✅ Sufficient color contrast
- ✅ Keyboard navigable

### Admin Section
- ✅ Title as heading
- ✅ Description paired with title
- ✅ Action buttons accessible

### Vendor/Category Cards
- ✅ Image alt text
- ✅ Link or button role
- ✅ Focus visible ring

---

## 🎯 Decision Tree

**Which card should I use?**

```
Is it in admin?
  ├─ Yes → Use AdminSection
  └─ No → Continue...

Is it a vendor?
  ├─ Yes → Use VendorCard
  └─ No → Continue...

Is it a category?
  ├─ Yes → Use CategoryCard
  └─ No → Continue...

Is it an offer/promotion?
  ├─ Yes → Use OfferCard
  └─ No → Use BaseCard
```

---

## 📚 Component Locations

| Card Type | Path | Imports |
|-----------|------|---------|
| Base Card | `/ui/card.tsx` | `import { Card } from "@/components/ui/card"` |
| Admin Section | `/admin/admin-section.tsx` | `import { AdminSection } from "@/components/admin"` |
| Admin Card | `/admin/admin-card.tsx` | `import { AdminCard } from "@/components/admin"` |
| Vendor Card | `/ui/vendor-card.tsx` | `import { VendorCard } from "@/components/ui/vendor-card"` |
| Category Card | `/design/category-card.tsx` | `import { CategoryCard } from "@/components/design/category-card"` |
| Offer Card | `/storefront/offer-card.tsx` | `import { OfferCard } from "@/components/storefront/offer-card"` |

---

## ✅ Best Practices

1. **Consistent Padding**: Use md (16px) by default
2. **Consistent Radius**: Use lg (12px) for cards
3. **Consistent Shadow**: Use sm for cards, md on hover
4. **Semantic Markup**: Use article/section, proper headings
5. **Responsive**: Mobile-first, scales to larger screens
6. **Accessibility**: Proper alt text, labels, keyboard nav

---

## 🔮 Future Improvements

- [ ] Extract common card patterns
- [ ] Create CardVariant component factory
- [ ] Add animation presets (fade, scale, slide)
- [ ] Add loading/skeleton states
- [ ] Document card composition patterns

---

## 📚 Related Documentation

- **Design System**: `/docs/DESIGN_SYSTEM.md`
- **Admin Components**: `/docs/ADMIN_COMPONENTS.md`
- **Components Directory**: `/src/components/`

---

**Maintained by**: Design System Team  
**Last Updated**: 2026-10-03  
**Status**: ✅ Production Ready

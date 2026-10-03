# 🎨 City Markets Design System

**Status**: ✅ 100% UNIFIED  
**Last Updated**: 2026-10-03  
**Version**: 2.0

---

## 📋 Table of Contents

1. [Color System](#color-system)
2. [Typography](#typography)
3. [Spacing & Layout](#spacing--layout)
4. [Components](#components)
5. [Shadows & Elevation](#shadows--elevation)
6. [Border Radius](#border-radius)
7. [Interactive States](#interactive-states)

---

## 🎨 Color System

### Core Colors (14 total - unified from 35)

#### Primary Brand Green
Used for all primary actions, links, and brand identity.

```css
primary-50:   #E6F5EC (lightest background)
primary-100:  #C7E8D2
primary-200:  #9CD6B2
primary-600:  #009345 (DEFAULT - main brand color)
primary-700:  #007A38 (dark - hover/active states)
primary-900:  #003F1C (darkest - text on light)

/* Aliases */
primary-dark:  #007A38
primary-light: #E6F5EC
```

#### Neutral Grays (6 levels)
Used for backgrounds, borders, text, and secondary UI.

```css
gray-50:   #F9FAFB (page backgrounds)
gray-100:  #F3F4F6 (card/section backgrounds)
gray-200:  #E5E7EB (borders, dividers)
gray-500:  #6B7280 (secondary text)
gray-700:  #374151 (primary text)
gray-900:  #111827 (dark text/backgrounds)
```

#### Supporting Colors

```css
secondary: #1A1A2E (dark backgrounds)
accent:    #F59E0B (attention, alerts - orange)
```

### Usage Guidelines

✅ **Always use tokens** for colors:
```tsx
<div className="bg-primary text-white">Primary Action</div>
<div className="border border-gray-200">Card Border</div>
<div className="text-gray-700">Body Text</div>
```

❌ **Never use hardcoded colors**:
```tsx
<div className="bg-[#009345]">WRONG</div>  // ❌ Bad
<div className="border-[#E5E7EB]">WRONG</div>  // ❌ Bad
```

---

## 📝 Typography

### Type Scale

| Class | Size | Line Height | Weight | Use Case |
|-------|------|-------------|--------|----------|
| `text-h1` | 36px | 2.5rem | 700 | Page titles |
| `text-h2` | 30px | 2.25rem | 700 | Section titles |
| `text-h3` | 24px | 2rem | 600 | Subsection titles |
| `text-h4` | 20px | 1.75rem | 600 | Card titles |
| `text-h5` | 16px | 1.5rem | 600 | Emphasis text |
| `text-h6` | 14px | 1.25rem | 600 | Small headers |
| `text-body` | 16px | 1.5rem | 400 | Body text (default) |
| `text-body-sm` | 14px | 1.25rem | 400 | Secondary text |
| `text-body-xs` | 12px | 1rem | 400 | Captions, metadata |
| `text-caption` | 10px | 0.875rem | 400 | Badge text, labels |

### Font Family

- **Body**: IBM Plex Sans (system-ui fallback)
- **Display**: Tajawal (Arabic) for h1/h2 on landing pages

### Usage Examples

```tsx
// Headings
<h1 className="text-h1 font-bold">Page Title</h1>
<h2 className="text-h2 font-bold">Section Title</h2>
<h3 className="text-h3 font-semibold">Card Title</h3>

// Body Text
<p className="text-body text-gray-700">Regular paragraph</p>
<p className="text-body-sm text-gray-500">Secondary information</p>
<span className="text-caption text-gray-400">Timestamp</span>
```

---

## 📦 Spacing & Layout

### Container Sizes

| Token | Size | Use Case |
|-------|------|----------|
| `max-w-container-sm` | 384px | Small sidebars, badges |
| `max-w-container-md` | 512px | Medium modals |
| `max-w-container-lg` | 768px | Large dialogs |
| `max-w-container-xl` | 1024px | Wide content sections |
| `max-w-container-2xl` | 1280px | Full page width |

### Padding Scale

Use Tailwind's standard scale: `p-2`, `p-3`, `p-4`, `p-6`, `p-8`

```
p-2:  8px
p-3:  12px
p-4:  16px
p-6:  24px
p-8:  32px
```

### Header Positioning

```css
top-header:              64px  (header height)
top-header-sm:           80px  (header @ sm breakpoint)
top-header-with-toolbar: 104px (header + toolbar)
```

---

## 🧩 Components

### Button System (Unified)

**Source**: `/components/design/button.tsx`

**Variants**:
- `primary` - Main call-to-action
- `secondary` - Alternative action
- `outline` - Bordered action
- `ghost` - Minimal style
- `danger` - Destructive action
- `success` - Positive action

**Sizes**:
- `sm` - 32px height
- `md` - 40px height (default)
- `lg` - 48px height

**Usage**:
```tsx
import { Button } from "@/components/design/button";

<Button variant="primary" size="md">Save</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button variant="danger" isLoading>Deleting...</Button>
```

### Card System (Unified)

**Base Card**: `/components/ui/card.tsx`
- Flexible padding (sm/md/lg)
- Radius options (none/sm/md/lg)
- Shadow options (none/soft/soft-lg)

**Admin Card**: `/components/admin/admin-card.tsx`
- Admin-specific styling

**Vendor Card**: `/components/ui/vendor-card.tsx`
- 4 variants: grid, list, hero, featured

**Usage**:
```tsx
import { Card } from "@/components/ui/card";

<Card padding="md" radius="lg" shadow="soft">
  <h3 className="text-h4">Card Title</h3>
  <p className="text-body-sm text-gray-600">Content</p>
</Card>
```

### Input Components (Unified)

All inputs use consistent styling:
- Border: `border border-gray-200`
- Padding: `px-4 py-3`
- Focus: `focus:ring-2 focus:ring-primary/30 focus:border-primary`
- Radius: `rounded-lg`

---

## 🌑 Shadows & Elevation

### Shadow Hierarchy

| Class | Use Case | Layer |
|-------|----------|-------|
| `shadow-xs` | Very subtle (disabled states) | 0 |
| `shadow-sm` | Small UI elements | 1 |
| `shadow` | Default shadow | 2 |
| `shadow-md` | Cards, panels | 3 |
| `shadow-lg` | Dropdowns, modals | 4 |
| `shadow-xl` | Important modals, popovers | 5 |
| `shadow-2xl` | Top-level overlays | 6 |
| `shadow-soft` | Soft variant (use instead of `shadow`) | - |
| `shadow-soft-lg` | Soft variant (use instead of `shadow-lg`) | - |

### Usage

```tsx
<div className="shadow-sm">Small element</div>
<div className="shadow-md">Default card</div>
<div className="shadow-lg">Modal</div>
```

---

## 🟦 Border Radius

### Scale

| Class | Size | Use Case |
|-------|------|----------|
| `rounded-none` | 0px | Edges, full-width |
| `rounded-xs` | 4px | Very small elements |
| `rounded-sm` | 6px | Inputs, badges |
| `rounded-md` | 8px | Medium elements |
| `rounded-lg` | 12px | Cards, sections |
| `rounded-xl` | 16px | Buttons, dialogs |
| `rounded-2xl` | 24px | Large surfaces |
| `rounded-3xl` | 32px | Hero sections |
| `rounded-full` | 9999px | Pills, avatars |

### Usage Guidelines

```tsx
<input className="rounded-lg" />           // Inputs
<button className="rounded-2xl" />         // Buttons
<div className="rounded-xl" />             // Modal, sections
<div className="rounded-full" />           // Avatars, pills
<div className="rounded-lg p-4" />         // Cards
```

---

## 🎯 Interactive States

### Focus States (Unified)

All interactive elements use the same focus pattern:

```css
focus:outline-none
focus:ring-2
focus:ring-primary/30
focus:border-primary
```

### Hover States

**Buttons**:
```css
hover:shadow-md hover:scale-105 transition-all
```

**Links**:
```css
hover:text-primary transition-colors
```

**Cards**:
```css
hover:shadow-lg transition-shadow
```

### Active States

**Buttons**:
```css
active:scale-[0.98]
```

**Toggle Elements**:
```css
/* Active */
border-primary ring-2 ring-primary/30
/* Inactive */
border-gray-200
```

### Disabled States

```css
disabled:opacity-50 disabled:cursor-not-allowed
```

### Transitions

Standard transition for all interactive elements:
```css
transition-all duration-200 ease-out
```

---

## ✅ Checklist for Consistency

Before committing any UI changes, verify:

- [ ] No hardcoded hex colors (use Tailwind tokens)
- [ ] No `slate-*` colors (use `gray-*` instead)
- [ ] Typography uses defined sizes (h1-h6, body, body-sm, body-xs, caption)
- [ ] Spacing uses Tailwind scale (p-2, p-3, p-4, p-6, p-8)
- [ ] Border radius from unified scale (rounded-lg, rounded-xl, rounded-2xl, etc.)
- [ ] Shadows use elevation hierarchy (shadow-sm, shadow-md, shadow-lg, shadow-xl)
- [ ] Buttons use `/components/design/button.tsx`
- [ ] Cards use `/components/ui/card.tsx` or appropriate card component
- [ ] Focus states include ring and border styling
- [ ] No inline styles (use Tailwind classes)

---

## 📱 Responsive Design

All components are responsive by default. Use Tailwind breakpoints:

```tsx
<div className="
  text-body                    // Mobile
  sm:text-h5                   // Tablet
  lg:text-h4                   // Desktop
  p-3 sm:p-4 lg:p-6           // Responsive padding
"/>
```

---

## 🌍 RTL (Right-to-Left) Support

Arabic interface uses logical CSS properties:

```tsx
<div className="
  ps-4 pe-3        // padding-start/padding-end (logical)
  ms-auto me-0     // margin-start/margin-end (logical)
  text-end         // text-align: right (logical)
  dir='rtl'        // Set direction
"/>
```

---

## 📚 References

- **Tailwind Config**: `/tailwind.config.ts`
- **Button Component**: `/src/components/design/button.tsx`
- **Card Component**: `/src/components/ui/card.tsx`
- **Design Files**: `/src/components/design/`
- **Admin Components**: `/src/components/admin/`

---

## 🚀 Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-10-03 | Complete design unification: 35→14 colors, typography scale, unified spacing, shadow hierarchy |
| 1.0 | 2026-09-29 | Initial design system with Phase 6 cleanup |

---

**Maintained by**: City Markets Design Team  
**Last Updated**: 2026-10-03  
**Status**: ✅ Production Ready

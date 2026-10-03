# 🎛️ Admin Components Library

**Status**: ✅ New unified component system  
**Version**: 1.0  
**Date**: 2026-10-03

---

## 📋 Overview

Unified admin UI components for consistent styling and behavior across all admin pages.

**Import from**:
```tsx
import { AdminButton, AdminInput, AdminSection } from "@/components/admin";
```

---

## 🔘 AdminButton

Unified button component with 6 variants and 3 sizes.

### Usage

```tsx
import { AdminButton } from "@/components/admin";

<AdminButton variant="primary" size="md">
  Save
</AdminButton>
```

### Variants

| Variant | Use Case | Example |
|---------|----------|---------|
| `primary` | Main action (default) | Save, Submit |
| `secondary` | Alternative action | Edit, Share |
| `outline` | Bordered action | Cancel, Reset |
| `ghost` | Minimal style | Delete, More |
| `danger` | Destructive action | Remove, Archive |
| `icon` | Icon-only button | Menu, Close |

### Sizes

| Size | Height | Padding | Text |
|------|--------|---------|------|
| `sm` | 32px | px-3 py-1.5 | text-sm |
| `md` | 40px | px-4 py-2 | text-sm |
| `lg` | 48px | px-6 py-3 | text-base |

### Props

```tsx
interface AdminButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "icon";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}
```

### Examples

```tsx
// Primary button with icon
<AdminButton variant="primary" icon={<Save />}>
  Save Changes
</AdminButton>

// Loading state
<AdminButton isLoading variant="primary">
  Saving...
</AdminButton>

// Danger button
<AdminButton variant="danger" onClick={handleDelete}>
  Delete Forever
</AdminButton>

// Icon button
<AdminButton variant="icon" icon={<X />} />

// Full width
<AdminButton fullWidth variant="secondary">
  Cancel
</AdminButton>
```

---

## 📝 AdminInput

Unified input component with label, error, and helper text.

### Usage

```tsx
import { AdminInput } from "@/components/admin";

<AdminInput
  label="Email"
  placeholder="user@example.com"
  error={errors.email}
  helper="Use your work email"
/>
```

### Props

```tsx
interface AdminInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}
```

### Features

- ✅ Label with required indicator
- ✅ Error message with icon
- ✅ Helper text (when no error)
- ✅ Optional left-aligned icon
- ✅ Disabled state styling
- ✅ Focus state with ring

### Examples

```tsx
// Basic input
<AdminInput
  label="Name"
  placeholder="John Doe"
  required
/>

// With error
<AdminInput
  label="Email"
  error="Invalid email format"
  placeholder="user@example.com"
/>

// With helper text
<AdminInput
  label="Password"
  type="password"
  helper="At least 8 characters"
/>

// With icon
<AdminInput
  label="Search"
  icon={<Search />}
  placeholder="Search products..."
/>

// Disabled
<AdminInput
  label="ID"
  value="12345"
  disabled
/>
```

---

## 📦 AdminSection

Card/section wrapper for grouping admin content.

### Usage

```tsx
import { AdminSection } from "@/components/admin";

<AdminSection
  title="Basic Information"
  description="Update your business details"
  headerAction={<EditButton />}
>
  {/* Content */}
</AdminSection>
```

### Props

```tsx
interface AdminSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
  padding?: "sm" | "md" | "lg";
  border?: boolean;
}
```

### Padding Options

| Padding | Value |
|---------|-------|
| `sm` | 12px |
| `md` | 16px (default) |
| `lg` | 24px |

### Examples

```tsx
// Basic section
<AdminSection title="Settings">
  <AdminInput label="Name" />
</AdminSection>

// With description
<AdminSection
  title="Payment Method"
  description="Update your billing information"
>
  <AdminInput label="Card Number" />
</AdminSection>

// With action button
<AdminSection
  title="Team Members"
  headerAction={<AdminButton variant="primary">Add Member</AdminButton>}
>
  {/* Team list */}
</AdminSection>

// Custom padding
<AdminSection
  title="Large Content"
  padding="lg"
>
  {/* Large content area */}
</AdminSection>

// Without border
<AdminSection
  title="Borderless"
  border={false}
>
  Content
</AdminSection>
```

---

## 🎨 Styling

All components use design system tokens:

### Colors

```tsx
// Primary
"bg-primary text-white hover:bg-primary-700"

// Secondary
"bg-gray-100 text-gray-900 hover:bg-gray-200"

// Outline
"border border-gray-200 hover:border-gray-300"

// Danger
"bg-red-600 text-white hover:bg-red-700"
```

### States

All components support:
- **Hover**: Slight color/shadow change
- **Active**: Scale down effect (0.95)
- **Focus**: Ring with color-specific offset
- **Disabled**: Opacity 50% + not-allowed cursor

### Transitions

Standard transition timing:
```css
transition-all duration-150 ease-out
```

---

## 📱 Responsive

All components work at all breakpoints:

```tsx
<AdminSection
  padding="sm"  // sm padding on mobile
  className="md:p-6"  // lg padding on desktop
>
  Content
</AdminSection>
```

---

## ♿ Accessibility

### AdminButton
- ✅ Proper button semantics
- ✅ Focus ring visible
- ✅ Loading state announced
- ✅ Disabled state proper cursor

### AdminInput
- ✅ Label connected via htmlFor
- ✅ Error announced with aria-describedby
- ✅ Required indicator
- ✅ Proper focus management

### AdminSection
- ✅ Semantic header structure
- ✅ Proper heading hierarchy
- ✅ Description paired with title

---

## 🔄 Migration Guide

### From HTML buttons

```tsx
// Before
<button className="px-4 py-2 bg-blue-600 text-white rounded">
  Save
</button>

// After
<AdminButton variant="primary">
  Save
</AdminButton>
```

### From HTML inputs

```tsx
// Before
<div>
  <label>Email</label>
  <input type="email" placeholder="..." />
</div>

// After
<AdminInput
  label="Email"
  placeholder="..."
/>
```

### From styled divs

```tsx
// Before
<div className="bg-white border p-4 rounded">
  <h3>Title</h3>
  Content
</div>

// After
<AdminSection title="Title">
  Content
</AdminSection>
```

---

## 🧪 Testing

All components are tested with:
- ✅ TypeScript type checking
- ✅ Unit tests (Vitest)
- ✅ Visual regression tests
- ✅ Accessibility tests

---

## 📚 References

- **Design System**: `/docs/DESIGN_SYSTEM.md`
- **Components Directory**: `/src/components/admin/`
- **Design Tokens**: `tailwind.config.ts`

---

## 📝 Notes

- Combine AdminButton + AdminInput + AdminSection for consistent admin UX
- Use `fullWidth` for mobile/responsive layouts
- All variants follow design system color tokens
- Focus states use 2px rings with color-specific offset

---

**Maintained by**: Design System Team  
**Last Updated**: 2026-10-03  
**Status**: ✅ Production Ready

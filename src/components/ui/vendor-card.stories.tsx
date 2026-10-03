import type { Meta, StoryObj } from '@storybook/react';
import { VendorCard } from './vendor-card';

/**
 * VendorCard Component
 *
 * Displays vendor information in multiple variants
 * Used for storefront, catalog, and search results pages
 */
const meta = {
  title: 'Design System/VendorCard',
  component: VendorCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof VendorCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const vendorProps = {
  name: 'مطعم البيت الشامي',
  slug: 'albayt-al-shami',
  category: 'مطاعم سورية',
  logo: 'https://via.placeholder.com/120',
  rating: 4.8,
  reviewCount: 234,
  deliveryTime: 25,
  distance: 1.2,
  isOpen: true,
};

export const Grid: Story = {
  args: {
    ...vendorProps,
    variant: 'grid',
  },
};

export const GridClosed: Story = {
  args: {
    ...vendorProps,
    variant: 'grid',
    isOpen: false,
  },
};

export const List: Story = {
  args: {
    ...vendorProps,
    variant: 'list',
    badge: <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">توصيل مجاني</span>,
  },
};

export const Hero: Story = {
  args: {
    ...vendorProps,
    variant: 'hero',
    banner: 'https://via.placeholder.com/400x200',
  },
};

export const Featured: Story = {
  args: {
    ...vendorProps,
    variant: 'featured',
    badge: <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded">مميز</span>,
  },
};

export const NoRating: Story = {
  args: {
    ...vendorProps,
    variant: 'grid',
    rating: undefined,
    reviewCount: undefined,
  },
};

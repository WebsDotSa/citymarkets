import type { Meta, StoryObj } from '@storybook/react';
import { AdminPageHeader } from './admin-page-header';
import { Plus } from 'lucide-react';

/**
 * AdminPageHeader Component
 *
 * Consistent header for all admin dashboard pages
 * Used to display page title, subtitle, and action buttons
 */
const meta = {
  title: 'Admin/AdminPageHeader',
  component: AdminPageHeader,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AdminPageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'الطلبات',
  },
};

export const WithSubtitle: Story = {
  args: {
    title: 'المنتجات',
    subtitle: 'إدارة جميع منتجات المتجر',
  },
};

export const WithAction: Story = {
  args: {
    title: 'الفئات',
    subtitle: 'إدارة فئات المتجر',
    action: (
      <button className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition">
        <Plus className="w-4 h-4" />
        فئة جديدة
      </button>
    ),
  },
};

export const ComplexHeader: Story = {
  args: {
    title: 'المبيعات والتحليلات',
    subtitle: 'تقارير شاملة عن أداء المتجر',
    action: (
      <div className="flex gap-2">
        <button className="px-3 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition">
          تصدير
        </button>
        <button className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition">
          تحديث
        </button>
      </div>
    ),
  },
};

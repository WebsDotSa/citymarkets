import type { Meta, StoryObj } from '@storybook/react';
import { AdminCard } from './admin-card';

/**
 * AdminCard Component
 *
 * Content container for admin sections
 * Used for filters, tables, forms, and stats
 */
const meta = {
  title: 'Admin/AdminCard',
  component: AdminCard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AdminCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="space-y-4">
        <p>محتوى البطاقة الإدارية</p>
      </div>
    ),
  },
};

export const WithTitle: Story = {
  args: {
    title: 'الفلاتر',
    children: (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">الحالة</label>
          <select className="w-full px-3 py-2 border border-gray-300 rounded-lg">
            <option>جميع الحالات</option>
            <option>قيد الانتظار</option>
            <option>مكتمل</option>
          </select>
        </div>
      </div>
    ),
  },
};

export const WithTitleAndSubtitle: Story = {
  args: {
    title: 'الإحصائيات',
    subtitle: 'ملخص أداء المتجر',
    children: (
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">الطلبات اليومية</p>
          <p className="text-2xl font-bold text-gray-900">1,234</p>
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">الإيرادات</p>
          <p className="text-2xl font-bold text-gray-900">15,650 ر.س</p>
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">الرضا</p>
          <p className="text-2xl font-bold text-gray-900">4.8/5</p>
        </div>
      </div>
    ),
  },
};

export const PaddingVariants: Story = {
  args: {
    title: 'محتوى بـ padding صغير',
    padding: 'sm',
    children: <p className="text-sm">محتوى برفع صغير</p>,
  },
};

export const PaddingLarge: Story = {
  args: {
    title: 'محتوى بـ padding كبير',
    padding: 'lg',
    children: (
      <div className="space-y-4">
        <p>محتوى برفع كبير مع مساحة واسعة</p>
      </div>
    ),
  },
};

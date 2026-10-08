import type { Meta, StoryObj } from '@storybook/react';
import { AdminButton } from './admin-button';
import { Plus, Trash2, Download, Edit } from 'lucide-react';

/**
 * AdminButton Component
 *
 * Action button with multiple variants and sizes
 * Used throughout admin interface for actions and navigation
 */
const meta = {
  title: 'Admin/AdminButton',
  component: AdminButton,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AdminButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'حفظ التغييرات',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'إلغاء',
  },
};

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'عرض التفاصيل',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'تحميل المزيد',
  },
};

export const Danger: Story = {
  args: {
    variant: 'danger',
    children: 'حذف',
    icon: <Trash2 className="w-4 h-4" />,
  },
};

export const IconButton: Story = {
  args: {
    variant: 'icon',
    icon: <Edit className="w-5 h-5" />,
  },
};

export const WithIcon: Story = {
  args: {
    variant: 'primary',
    icon: <Plus className="w-4 h-4" />,
    children: 'إضافة جديد',
  },
};

export const SmallSize: Story = {
  args: {
    variant: 'primary',
    size: 'sm',
    children: 'حفظ',
  },
};

export const MediumSize: Story = {
  args: {
    variant: 'primary',
    size: 'md',
    children: 'حفظ التغييرات',
  },
};

export const LargeSize: Story = {
  args: {
    variant: 'primary',
    size: 'lg',
    children: 'حفظ التغييرات والمتابعة',
  },
};

export const Loading: Story = {
  args: {
    variant: 'primary',
    isLoading: true,
    children: 'جارٍ الحفظ...',
  },
};

export const Disabled: Story = {
  args: {
    variant: 'primary',
    disabled: true,
    children: 'غير متاح',
  },
};

export const FullWidth: Story = {
  args: {
    variant: 'primary',
    fullWidth: true,
    icon: <Download className="w-4 h-4" />,
    children: 'تحميل التقرير',
  },
};

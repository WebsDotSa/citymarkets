import type { Meta, StoryObj } from '@storybook/react';
import { Chip } from './chip';
import { X } from 'lucide-react';

/**
 * Chip Component
 *
 * Compact element for displaying tags, badges, or filters
 * Used for categorization, filtering, and status indicators
 */
const meta = {
  title: 'Design System/Chip',
  component: Chip,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'تصنيف',
    variant: 'default',
  },
};

export const Outlined: Story = {
  args: {
    label: 'نشط',
    variant: 'outlined',
  },
};

export const Selected: Story = {
  args: {
    label: 'مختار',
    selected: true,
  },
};

export const WithClickHandler: Story = {
  args: {
    label: 'اضغط هنا',
    onClick: () => alert('تم الضغط'),
  },
};

export const WithIcon: Story = {
  args: {
    label: 'مع أيقونة',
    icon: <X className="w-4 h-4" />,
  },
};

export const Disabled: Story = {
  args: {
    label: 'معطّل',
    disabled: true,
  },
};

import type { Meta, StoryObj } from '@storybook/react';
import { PageHeader } from './page-header';
import { Heart, Settings, Bell, ArrowRight } from 'lucide-react';

/**
 * PageHeader Component
 *
 * Displays page title with optional icon, subtitle, and action
 * Used at the top of all pages for consistent navigation context
 */
const meta = {
  title: 'Design System/PageHeader',
  component: PageHeader,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'صفحتك الشخصية',
    subtitle: 'أدر معلومات حسابك والتفضيلات',
  },
};

export const WithIcon: Story = {
  args: {
    icon: <Heart className="w-6 h-6 text-red-500" />,
    title: 'المفضلة',
    subtitle: 'قوائمك المحفوظة والعناصر المفضلة',
  },
};

export const PrimaryIcon: Story = {
  args: {
    icon: <Settings className="w-6 h-6 text-primary" />,
    title: 'الإعدادات',
    subtitle: 'تخصيص تجربتك',
  },
};

export const NoSubtitle: Story = {
  args: {
    title: 'الإشعارات',
  },
};

export const WithAction: Story = {
  args: {
    icon: <Bell className="w-6 h-6 text-amber-500" />,
    title: 'الإشعارات',
    subtitle: 'تحكم في تنبيهات الطلبات',
    action: <ArrowRight className="w-5 h-5 text-gray-400" />,
    actionAlign: 'right',
  },
};

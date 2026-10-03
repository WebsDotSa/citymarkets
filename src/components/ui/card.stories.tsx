import type { Meta, StoryObj } from '@storybook/react';
import { Card } from './card';

/**
 * Card Component
 *
 * Container for grouped content with rounded corners and shadow
 * Used throughout the app for layouts and content grouping
 */
const meta = {
  title: 'Design System/Card',
  component: Card,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="p-4">
        <h3 className="font-semibold text-gray-900">بطاقة أساسية</h3>
        <p className="text-sm text-gray-600 mt-2">محتوى البطاقة يأتي هنا</p>
      </div>
    ),
  },
};

export const WithDividers: Story = {
  args: {
    children: (
      <div className="divide-y divide-gray-200">
        <div className="p-4">المقسم الأول</div>
        <div className="p-4">المقسم الثاني</div>
        <div className="p-4">المقسم الثالث</div>
      </div>
    ),
  },
};

export const WithImage: Story = {
  args: {
    className: 'max-w-xs overflow-hidden',
    children: (
      <>
        <div className="h-32 bg-gradient-to-br from-primary-100 to-primary-50 flex items-center justify-center">
          <span className="text-4xl">🖼️</span>
        </div>
        <div className="p-4">
          <h3 className="font-semibold">صورة + محتوى</h3>
          <p className="text-sm text-gray-600 mt-1">النمط الشائع للبطاقات</p>
        </div>
      </>
    ),
  },
};

export const Interactive: Story = {
  args: {
    className: 'max-w-xs cursor-pointer hover:shadow-lg transition-shadow',
    children: (
      <div className="p-4">
        <h3 className="font-semibold">بطاقة تفاعلية</h3>
        <p className="text-sm text-gray-600 mt-2">مرر الماوس فوقها</p>
      </div>
    ),
  },
};

import type { Meta, StoryObj } from '@storybook/react';
import { AdminInput } from './admin-input';
import { Mail, Phone } from 'lucide-react';

/**
 * AdminInput Component
 *
 * Consistent input field with label, error, and hint support
 * Used in all admin forms and filters
 */
const meta = {
  title: 'Admin/AdminInput',
  component: AdminInput,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AdminInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: 'أدخل النص هنا',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'اسم المنتج',
    placeholder: 'أدخل اسم المنتج',
  },
};

export const Required: Story = {
  args: {
    label: 'البريد الإلكتروني',
    placeholder: 'example@domain.com',
    required: true,
  },
};

export const WithHint: Story = {
  args: {
    label: 'السعر',
    placeholder: '0.00',
    hint: 'السعر بالريال السعودي',
  },
};

export const WithError: Story = {
  args: {
    label: 'كلمة المرور',
    type: 'password',
    placeholder: '••••••••',
    error: 'كلمة المرور قصيرة جداً',
  },
};

export const WithIcon: Story = {
  args: {
    label: 'البريد الإلكتروني',
    type: 'email',
    placeholder: 'البريد الإلكتروني',
    icon: <Mail className="w-5 h-5 text-gray-400" />,
  },
};

export const Disabled: Story = {
  args: {
    label: 'حقل معطّل',
    placeholder: 'لا يمكن التعديل',
    disabled: true,
  },
};

export const PhoneInput: Story = {
  args: {
    label: 'رقم الهاتف',
    type: 'tel',
    placeholder: '+966 50 0000 000',
    icon: <Phone className="w-5 h-5 text-gray-400" />,
    required: true,
    hint: 'أدخل رقم الهاتف بصيغة دولية',
  },
};

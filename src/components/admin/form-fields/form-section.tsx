"use client";

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({
  title,
  description,
  children,
  className = "",
}: FormSectionProps) {
  return (
    <div className={`admin-card ${className}`}>
      <div className="admin-card-header">
        <h3 className="admin-card-title">{title}</h3>
        {description && (
          <p className="text-sm text-gray-500">{description}</p>
        )}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

interface FormRowProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormRow({ label, required, children, className = "" }: FormRowProps) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <label className="w-32 text-sm font-medium text-gray-700 flex-shrink-0">
        {label}
        {required && <span className="text-red-500 mr-1">*</span>}
      </label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

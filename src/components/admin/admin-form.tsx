"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import type { FormField } from "./form-fields/form-field";
import { HiddenField } from "./form-fields/hidden";
import { TextareaField } from "./form-fields/textarea";
import { SelectField } from "./form-fields/select";
import { Select2Field } from "./form-fields/select2";
import { MultiselectField } from "./form-fields/multiselect";
import { CheckboxField } from "./form-fields/checkbox";
import { SwitchField } from "./form-fields/switch";
import { PasswordField } from "./form-fields/password";
import { ImageField } from "./form-fields/image-field";
import { ImagesField } from "./form-fields/images-field";
import { ColorField } from "./form-fields/color-field";
import { DateTimeField } from "./form-fields/date-time-field";
import { FileField } from "./form-fields/file-field";
import { DefaultField } from "./form-fields/default-field";
import { FormFieldRow } from "./form-fields/form-field-row";
import { FormLayout } from "./form-fields/form-layout";
import { FormSection, FormRow } from "./form-fields/form-section";
import { useSelect2Init } from "./form-fields/use-select2";
import { useImageHandlers } from "./form-fields/use-image-handlers";
import { useFormSubmit } from "./form-fields/use-form-submit";
import { PreviewButton } from "./preview-button";

export { FormSection, FormRow };
export type { FormField } from "./form-fields/form-field";

interface AdminFormProps {
  fields: FormField[];
  title: string;
  subtitle?: string;
  initialValues?: Record<string, unknown>;
  resetKey?: string | number;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "card" | "inline";
  showHeader?: boolean;
  showFooter?: boolean;
  /**
   * Optional preview affordance — when provided, a "معاينة" button appears
   * between Cancel and Submit. Editors see the live form values rendered as
   * the storefront-equivalent card so they can confirm before saving.
   * See `PreviewButton` for the renderer contract.
   */
  renderPreview?: (data: Record<string, unknown>) => ReactNode;
  previewTitle?: string;
  previewDescription?: string;
  previewLabel?: string;
}

export function AdminForm({
  fields,
  title,
  subtitle,
  initialValues = {},
  resetKey,
  onSubmit,
  onCancel,
  loading = false,
  submitLabel = "حفظ",
  cancelLabel = "إلغاء",
  variant = "card",
  showHeader = true,
  showFooter = true,
  renderPreview,
  previewTitle,
  previewDescription,
  previewLabel,
}: AdminFormProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const handleChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setTouched((prev) => new Set(prev).add(key));

    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }

    const field = fields.find((f) => f.key === key);
    field?.onChange?.(value, key);
  }, [errors, fields]);

  const select2Instances = useSelect2Init(fields, handleChange);

  // Track previous initialValues so we only override fields whose source
  // value changed. This lets parents push async-loaded values (e.g. an
  // uploaded logo URL) into specific fields without nuking whatever the
  // user has typed elsewhere.
  const prevInitialJson = useRef<string | null>(null);
  useEffect(() => {
    const json = JSON.stringify(initialValues);
    if (resetKey !== undefined || prevInitialJson.current === null) {
      // Hard reset (parent explicitly asked via resetKey, or first mount).
      setFormData(initialValues);
      setErrors({});
      setTouched(new Set());
      Object.keys(select2Instances.current).forEach((key) => {
        const $el = $(`#select2-${key}`);
        if ($el.length) {
          const field = fields.find((f) => f.key === key);
          const value = field?.type === "multiselect" ? [] : "";
          $el.val(value).trigger("change");
        }
      });
    } else {
      // Soft merge: only set fields whose JSON value changed.
      const prev = prevInitialJson.current ? (JSON.parse(prevInitialJson.current) as Record<string, unknown>) : {};
      const next = initialValues;
      setFormData((current) => {
        const merged = { ...current };
        let touched_changed = false;
        for (const key of Object.keys(next)) {
          const before = JSON.stringify(prev[key] ?? null);
          const after = JSON.stringify(next[key] ?? null);
          if (before !== after) {
            merged[key] = next[key];
            // Clear validation error for this field — the source value
            // changed, so any prior error is stale.
            setErrors((e) => {
              if (!(key in e)) return e;
              const { [key]: _drop, ...rest } = e;
              touched_changed = true;
              return rest;
            });
          }
        }
        if (touched_changed) {
          // no-op placeholder so linter doesn't flag setErrors side effect
        }
        return merged;
      });
    }
    prevInitialJson.current = json;
  }, [resetKey, JSON.stringify(initialValues), fields]);

  const handleBlur = useCallback(
    (key: string) => {
      setTouched((prev) => new Set(prev).add(key));

      const field = fields.find((f) => f.key === key);
      if (field?.validate) {
        const error = field.validate(formData[key]);
        if (error) {
          setErrors((prev) => ({ ...prev, [key]: error }));
        }
      }
    },
    [fields, formData]
  );

  const handleSubmit = useFormSubmit(formData, setErrors, onSubmit);
  const { handleImageUpload, handleMultiImageUpload, removeImage } =
    useImageHandlers(formData, handleChange);

  const renderField = (field: FormField) => {
    const hasError = touched.has(field.key) && !!errors[field.key];
    const errorClass = hasError ? "admin-input-error" : "";
    const value = formData[field.key];

    switch (field.type) {
      case "hidden":
        return <HiddenField field={field} value={value} />;
      case "textarea":
        return <TextareaField field={field} value={value} errorClass={errorClass} onChange={handleChange} onBlur={handleBlur} />;
      case "select":
        return <SelectField field={field} value={value} errorClass={errorClass} onChange={handleChange} onBlur={handleBlur} />;
      case "select2":
        return <Select2Field field={field} value={value} errorClass={errorClass} hasError={hasError} error={errors[field.key]} />;
      case "multiselect":
        return <MultiselectField field={field} value={value} errorClass={errorClass} hasError={hasError} error={errors[field.key]} />;
      case "checkbox":
        return <CheckboxField field={field} value={value} onChange={handleChange} />;
      case "switch":
        return <SwitchField field={field} value={value} onChange={handleChange} />;
      case "password":
        return (
          <PasswordField
            field={field}
            value={value}
            errorClass={errorClass}
            showPassword={!!showPassword[field.key]}
            onChange={handleChange}
            onBlur={handleBlur}
            onToggleVisibility={(key) =>
              setShowPassword((prev) => ({ ...prev, [key]: !prev[key] }))
            }
          />
        );
      case "image":
        return <ImageField field={field} value={value} onChange={handleChange} onImageUpload={handleImageUpload} onRemoveImage={removeImage} />;
      case "images":
        return <ImagesField field={field} value={value} onMultiImageUpload={handleMultiImageUpload} onRemoveImage={removeImage} />;
      case "color":
        return <ColorField field={field} value={value} errorClass={errorClass} onChange={handleChange} />;
      case "date":
      case "time":
      case "datetime":
        return <DateTimeField field={field} value={value} errorClass={errorClass} onChange={handleChange} onBlur={handleBlur} />;
      case "file":
        return <FileField field={field} value={value} onChange={handleChange} />;
      default:
        return <DefaultField field={field} value={value} errorClass={errorClass} onChange={handleChange} onBlur={handleBlur} />;
    }
  };

  return (
    <FormLayout
      title={title}
      subtitle={subtitle}
      showHeader={showHeader}
      showFooter={showFooter}
      loading={loading}
      submitLabel={submitLabel}
      cancelLabel={cancelLabel}
      onCancel={onCancel}
      variant={variant}
      formRef={formRef}
      onSubmit={(e) => handleSubmit(e, fields)}
      secondaryAction={
        renderPreview ? (
          <PreviewButton
            formData={formData}
            renderPreview={renderPreview}
            previewTitle={previewTitle}
            previewDescription={previewDescription}
            label={previewLabel}
            disabled={loading}
          />
        ) : undefined
      }
    >
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
        {fields.map((field) => {
          const hasError = touched.has(field.key) && !!errors[field.key];
          return (
            <FormFieldRow
              key={field.key}
              field={field}
              hasError={hasError}
              error={errors[field.key]}
            >
              {renderField(field)}
            </FormFieldRow>
          );
        })}
      </div>
    </FormLayout>
  );
}

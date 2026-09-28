"use client";

import { useState, ReactNode, useMemo } from "react";
import { Eye } from "lucide-react";
import { Modal } from "@/components/ui/admin/modal";

interface PreviewButtonProps<T extends Record<string, unknown>> {
  /** Current form values — the button re-renders the preview live as values change. */
  formData: T;
  /**
   * Renders the storefront-equivalent preview. Receive the live formData so
   * editors see exactly what shoppers will see once the record is saved.
   */
  renderPreview: (data: T) => ReactNode;
  /** Modal title, e.g. "معاينة المنتج كما يظهر للمتسوق". */
  previewTitle?: string;
  /** Optional helper text shown under the title. */
  previewDescription?: string;
  /** Override the default "معاينة" label on the button. */
  label?: string;
  /** Disable when the form is mid-submit so the preview doesn't fight with a save. */
  disabled?: boolean;
  /**
   * Extra Tailwind classes for the button — used to match the surrounding
   * form actions (outline style on Stores, primary-on-light on Products, etc).
   */
  buttonClassName?: string;
}

/**
 * Reusable admin-side preview trigger. Each form that wants the "see it like
 * a shopper would" affordance just passes a renderer for its own entity; the
 * modal + body styles stay here so every preview looks consistent.
 *
 * The renderer receives the *live* formData, so editors can confirm changes
 * before committing — useful for product cards where price/discount/featured
 * badges all combine into a single visual.
 */
export function PreviewButton<T extends Record<string, unknown>>({
  formData,
  renderPreview,
  previewTitle = "معاينة",
  previewDescription,
  label = "معاينة",
  disabled,
  buttonClassName = "admin-btn-outline",
}: PreviewButtonProps<T>) {
  const [open, setOpen] = useState(false);

  // Re-render the preview only while the modal is open. Re-rendering a heavy
  // card tree on every keystroke while the modal is closed is wasted work.
  const previewNode = useMemo(
    () => (open ? renderPreview(formData) : null),
    [open, formData, renderPreview]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`${buttonClassName} flex items-center gap-2`}
      >
        <Eye className="w-4 h-4" />
        <span>{label}</span>
      </button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={previewTitle}
        description={previewDescription}
        size="lg"
      >
        {previewNode}
      </Modal>
    </>
  );
}
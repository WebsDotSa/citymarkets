"use client";

export function useImageHandlers(
  formData: Record<string, unknown>,
  handleChange: (key: string, value: unknown) => void
) {
  const handleImageUpload = (key: string, files: FileList | null) => {
    if (!files || files.length === 0) return;

    if (key !== "images") {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          handleChange(key, e.target?.result);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleMultiImageUpload = (key: string, files: FileList | null) => {
    if (!files || files.length === 0) return;

    const currentImages = (formData[key] as string[]) || [];
    const newImages: string[] = [];

    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          newImages.push(e.target?.result as string);
          if (newImages.length === files.length) {
            handleChange(key, [...currentImages, ...newImages]);
          }
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const removeImage = (key: string, index?: number) => {
    if (key === "images" && index !== undefined) {
      const currentImages = (formData[key] as string[]) || [];
      handleChange(
        key,
        currentImages.filter((_, i) => i !== index)
      );
    } else {
      handleChange(key, "");
    }
  };

  return { handleImageUpload, handleMultiImageUpload, removeImage };
}

"use client";

import React from "react";

export interface AdminSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
  padding?: "sm" | "md" | "lg";
  border?: boolean;
}

const paddingClasses = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export function AdminSection({
  title,
  description,
  children,
  className = "",
  headerAction,
  padding = "md",
  border = true,
}: AdminSectionProps) {
  return (
    <div
      className={`
        bg-white rounded-lg
        ${border ? "border border-gray-200" : ""}
        ${className}
      `}
    >
      {(title || description || headerAction) && (
        <div
          className={`
            ${paddingClasses[padding]}
            ${title || description ? "border-b border-gray-200" : ""}
            flex items-start justify-between
          `}
        >
          <div className="flex-1">
            {title && (
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            )}
            {description && (
              <p className="text-sm text-gray-600 mt-0.5">{description}</p>
            )}
          </div>
          {headerAction && <div className="ml-4">{headerAction}</div>}
        </div>
      )}

      <div className={paddingClasses[padding]}>{children}</div>
    </div>
  );
}

import React from "react";
import type { ModelOption } from "./types";
import { Select } from "../../ui/Select";

type ModelSelectProps = {
  value: string;
  options: ModelOption[];
  disabled?: boolean;
  placeholder?: string;
  isLoading?: boolean;
  onSelect: (value: string) => void;
  onCreate: (value: string) => void;
  onBlur: () => void;
  className?: string;
  isCreatable?: boolean;
};

export const ModelSelect: React.FC<ModelSelectProps> = React.memo(
  ({
    value,
    options,
    disabled,
    placeholder,
    isLoading,
    onSelect,
    onCreate,
    onBlur,
    className = "flex-1 min-w-[360px]",
    isCreatable = true,
  }) => {
    const handleCreate = (inputValue: string) => {
      const trimmed = inputValue.trim();
      if (!trimmed) return;
      onCreate(trimmed);
    };

    const computedClassName = `text-sm ${className}`;
    const commonProps = {
      className: computedClassName,
      value: value || null,
      options,
      onChange: (selected: string | null) => onSelect(selected ?? ""),
      onBlur,
      placeholder,
      disabled,
      isLoading,
    };

    if (isCreatable) {
      return (
        <Select
          {...commonProps}
          isCreatable
          onCreateOption={handleCreate}
          formatCreateLabel={(input) => `Use "${input}"`}
        />
      );
    }

    return <Select {...commonProps} isCreatable={false} />;
  },
);

ModelSelect.displayName = "ModelSelect";

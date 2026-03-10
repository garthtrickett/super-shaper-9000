// src/components/ui/notion-input.ts
import { html, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";

/**
 * Defines the properties that the NotionInput component can accept.
 */
interface NotionInputProps {
  id: string;
  label: string;
  // ✅ FIX: Added "number" to allowed types
  type?: "text" | "email" | "password" | "number";
  value?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  onInput?: (e: Event) => void;
}

/**
 * A functional, stateless input component that returns a lit-html template.
 * It's styled to match the project's aesthetic and is designed for easy composition.
 * @param props The properties for the input field.
 * @returns A TemplateResult to be rendered by lit-html.
 */
export const NotionInput = (props: NotionInputProps): TemplateResult => {
  const {
    id,
    label,
    type = "text",
    value = "",
    placeholder = "",
    required = false,
    disabled = false,
    onInput,
  } = props;

  // Base classes for the label element
  const labelClasses = {
    block: true,
    "text-sm": true,
    "font-medium": true,
    "text-zinc-700": true,
  };

  // Base classes for the input element, matching login/signup pages
  const inputClasses = {
    "mt-1": true,
    block: true,
    "w-full": true,
    "rounded-md": true,
    border: true,
    "border-zinc-300": true,
    "px-3": true,
    "py-2": true,
    "shadow-sm": true,
    "focus:border-zinc-500": true,
    "focus:outline-none": true,
    "focus:ring-zinc-500": true,
    "sm:text-sm": true,
    "disabled:pointer-events-none": true,
    "disabled:bg-zinc-100": true,
  };

  return html`
    <div>
      <label for=${id} class=${classMap(labelClasses)}>${label}</label>
      <input
        .type=${type}
        .id=${id}
        .name=${id}
        .value=${value}
        .placeholder=${placeholder}
        ?required=${required}
        ?disabled=${disabled}
        @input=${(e: Event) => onInput?.(e)}
        class=${classMap(inputClasses)}
      />
    </div>
  `;
};

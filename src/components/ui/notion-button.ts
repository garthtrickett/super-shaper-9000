// File: ./src/components/ui/notion-button.ts
import { html, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";

interface NotionButtonProps {
  children: TemplateResult | string;
  loading?: boolean;
  href?: string;
  type?: "button" | "submit" | "reset";
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
}

export const NotionButton = (props: NotionButtonProps): TemplateResult => {
  const {
    children,
    loading = false,
    href,
    type = "submit",
    onClick,
    disabled = false,
  } = props;

  const _handleClick = (e: MouseEvent) => {
    if (disabled || loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };

  const classes = {
    "inline-flex": true,
    "items-center": true,
    "justify-center": true,
    "gap-2": true,
    "px-4": true,
    "py-2": true,
    "bg-zinc-800": true,
    "text-white": true,
    "rounded-md": true,
    "hover:bg-zinc-700": true,
    "font-semibold": true,
    "text-sm": true,
    "transition-colors": true,
    "duration-150": true,
    "focus-visible:outline-none": true,
    "focus-visible:ring-2": true,
    "focus-visible:ring-zinc-500": true,
    "focus-visible:ring-offset-2": true,
    "disabled:bg-zinc-600": true,
    "disabled:pointer-events-none": true,
  };

  // We explicitly use 'null' for conditional rendering to be safe with all Lit versions
  const spinner = html`
    <span
      class="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-white"
      aria-hidden="true"
    ></span>
  `;

  if (href) {
    return html`
      <a href=${href} class=${classMap(classes)}>
        ${children}
      </a>
    `;
  }

  return html`
    <button
      .type=${type}
      ?disabled=${loading || disabled}
      aria-busy=${loading ? "true" : "false"}
      @click=${_handleClick}
      class=${classMap(classes)}
    >
      ${loading ? spinner : null}
      ${children}
    </button>
  `;
};

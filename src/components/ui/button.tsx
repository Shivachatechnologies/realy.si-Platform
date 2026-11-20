import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.18),0_1px_2px_oklch(0_0_0/0.12)] hover:bg-primary/90 hover:shadow-glow",
        secondary: "border bg-surface shadow-elev-1 hover:border-border-strong hover:bg-muted",
        ghost: "hover:bg-muted",
        danger: "bg-danger text-danger-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.15)] hover:bg-danger/90",
        link: "text-primary underline-offset-4 hover:underline [&::after]:hidden",
        /** Brand gradient call-to-action (hero actions, upgrade prompts). */
        gradient: "bg-brand-gradient text-primary-foreground shadow-glow hover:brightness-110",
        /** Quiet tinted accent. */
        soft: "bg-accent text-accent-foreground hover:bg-accent/80",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-5",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

/**
 * `loading` (optional) disables the button, sets aria-busy and shows a spinner before the label.
 * With `asChild` the spinner is skipped (Slot needs a single child) but aria-busy/disabled styling still apply.
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean }) {
  const cls = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot.Root className={cls} aria-busy={loading || undefined} {...(disabled !== undefined ? { disabled } : {})} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

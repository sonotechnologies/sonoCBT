import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-bold whitespace-nowrap no-underline transition-colors cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-ink-raised",
        pencil: "bg-accent text-accent-foreground font-extrabold hover:brightness-95",
        outline: "border-[1.5px] border-input bg-card text-foreground font-semibold hover:bg-secondary",
        // The design's "not yet" state: flat, readable, clearly inactive.
        waiting: "bg-border text-ink-2",
      },
      size: {
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-[15px]",
        xl: "h-14 px-7 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "lg" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

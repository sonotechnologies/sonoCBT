import { cn } from "@/lib/utils";

/** Label-wrapped field, as in the designs: 13px semibold label above a 52px control. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-[13px] font-semibold", className)}>
      <span className="flex justify-between">{label}</span>
      {children}
      {hint && <span className="font-medium text-muted-foreground">{hint}</span>}
      {error && (
        <span role="alert" className="font-semibold text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

const control =
  "h-[52px] w-full rounded-md border-[1.5px] border-input bg-card px-3.5 text-base font-medium text-foreground placeholder:text-muted-foreground placeholder:font-normal focus:border-2 focus:border-primary focus:px-[13.5px] focus:outline-none focus-visible:outline-3 focus-visible:outline-ring aria-invalid:border-destructive";

export function Input({ className, mono, ...props }: React.ComponentProps<"input"> & { mono?: boolean }) {
  return <input className={cn(control, mono && "font-mono", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(control, "appearance-auto", className)} {...props} />;
}

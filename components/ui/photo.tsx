import { cn } from "@/lib/utils";

/** A photo, logo or crest; falls back to the design's hatched placeholder when there's no image. */
export function Photo({
  src,
  alt,
  className,
  style,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  /** e.g. override `--hatch` / `--background` to tint the placeholder on a coloured header. */
  style?: React.CSSProperties;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- R2 URLs, sized by the caller
    return <img src={src} alt={alt} className={cn("flex-none border border-border object-cover", className)} />;
  }
  return <div role="img" aria-label={alt} style={style} className={cn("hatch flex-none border border-border", className)} />;
}

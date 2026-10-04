"use client";

import { useEffect, useState } from "react";
import { Field, Input } from "@/components/ui/field";
import { BRAND_SWATCHES } from "@/lib/school/defaults";
import { cn } from "@/lib/utils";

export function BrandingFields({
  schoolName,
  locality,
  motto: initialMotto,
  brandColor,
  logoUrl,
  signatureUrl,
  principalName,
}: {
  schoolName: string;
  locality: string | null;
  motto: string;
  brandColor: string;
  logoUrl: string | null;
  signatureUrl: string | null;
  principalName: string | null;
}) {
  const [color, setColor] = useState(brandColor);
  const [motto, setMotto] = useState(initialMotto);
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [removed, setRemoved] = useState(false);
  const [sig, setSig] = useState<string | null>(signatureUrl);
  const [sigRemoved, setSigRemoved] = useState(false);

  useEffect(() => () => {
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
  }, [preview]);

  const custom = !BRAND_SWATCHES.includes(color.toUpperCase());

  return (
    <div className="grid grid-cols-1 gap-7 sm:grid-cols-[220px_1fr]">
      <div className="flex flex-col gap-2">
        <label
          className={cn(
            "relative flex h-[220px] cursor-pointer items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-dashed border-input p-4 text-center font-mono text-xs text-muted-foreground focus-within:outline-3 focus-within:outline-ring",
            !preview && "bg-[repeating-linear-gradient(135deg,#F3F0E8_0_8px,#FFFFFF_8px_16px)]",
          )}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview / uploaded crest
            <img src={preview} alt="School crest" className="max-h-full max-w-full object-contain" />
          ) : (
            <span>
              school crest
              <br />
              PNG, JPG or SVG · under 1 MB
              <br />
              (PNG or JPG prints on PDF report cards)
            </span>
          )}
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Upload school crest"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setPreview(URL.createObjectURL(f));
                setRemoved(false);
              }
            }}
          />
        </label>
        {preview && (
          <button
            type="button"
            className="self-start text-[13px] font-semibold text-ink-2 underline"
            onClick={() => {
              setPreview(null);
              setRemoved(true);
            }}
          >
            Remove crest
          </button>
        )}
        <input type="hidden" name="removeLogo" value={removed ? "1" : ""} />
      </div>

      <div className="flex flex-col gap-[18px]">
        <Field label="Motto">
          <Input name="motto" value={motto} onChange={(e) => setMotto(e.target.value)} className="h-[46px] text-[15px]" />
        </Field>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-[13px] font-semibold">School colour</legend>
          <div className="flex flex-wrap items-center gap-2.5">
            {BRAND_SWATCHES.map((hex) => (
              <label key={hex} className="cursor-pointer">
                <input
                  type="radio"
                  name="brandColorChoice"
                  value={hex}
                  checked={color.toUpperCase() === hex}
                  onChange={() => setColor(hex)}
                  className="peer sr-only"
                />
                <span
                  aria-label={hex}
                  className="block size-11 rounded-full border-[3px] border-white outline-1 outline-input peer-checked:outline-3 peer-checked:outline-ink peer-focus-visible:outline-3 peer-focus-visible:outline-ring"
                  style={{ background: hex }}
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className={cn("size-11 cursor-pointer rounded-full border-[3px] border-white bg-transparent", custom ? "outline-3 outline-ink" : "outline-1 outline-input")}
                aria-label="Pick another colour"
              />
              Other
            </label>
          </div>
          <input type="hidden" name="brandColor" value={color} />
        </fieldset>
        <p className="text-[13px] leading-normal text-muted-foreground">
          Appears only on report cards and your school&apos;s login header. SonoCBT&apos;s own colours stay the same.
        </p>
        <div className="overflow-hidden rounded-lg border border-border bg-card" aria-hidden>
          <div className="h-2" style={{ background: color }} />
          <div className="flex items-center gap-3 px-4 py-3.5">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview only
              <img src={preview} alt="" className="size-9 rounded-md object-contain" />
            ) : (
              <span className="size-9 rounded-md" style={{ background: color }} />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold uppercase">
                {[schoolName, locality].filter(Boolean).join(", ")}
              </div>
              {motto && <div className="truncate text-xs text-muted-foreground italic">{motto}</div>}
            </div>
            <span className="ml-auto flex-none text-[11px] text-muted-foreground">Report card preview</span>
          </div>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-semibold">Principal&apos;s signature (printed on report cards)</legend>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative flex h-[72px] w-[220px] cursor-pointer items-center justify-center overflow-hidden rounded-lg border-[1.5px] border-dashed border-input bg-card p-2 text-center font-mono text-xs text-muted-foreground focus-within:outline-3 focus-within:outline-ring">
              {sig ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview / uploaded signature
                <img src={sig} alt="Principal's signature" className="max-h-full max-w-full object-contain" />
              ) : (
                <span>PNG or JPG · under 500 KB</span>
              )}
              <input
                type="file"
                name="signature"
                accept="image/png,image/jpeg"
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Upload the principal's signature"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setSig(URL.createObjectURL(f));
                    setSigRemoved(false);
                  }
                }}
              />
            </label>
            <div className="text-[13px] text-ink-2">
              {principalName ? `Signs as ${principalName}, Principal.` : "Add the principal's name in School details."}
              {sig && (
                <button
                  type="button"
                  className="mt-1 block text-[13px] font-semibold text-ink-2 underline"
                  onClick={() => {
                    setSig(null);
                    setSigRemoved(true);
                  }}
                >
                  Remove signature
                </button>
              )}
            </div>
          </div>
          <input type="hidden" name="removeSignature" value={sigRemoved ? "1" : ""} />
        </fieldset>
      </div>
    </div>
  );
}

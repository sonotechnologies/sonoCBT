"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";

/** Set by a school's student sign-in page, so the app can take a student back there. */
const KEY = "sonocbt-school";
const noop = () => () => {};

function read(): { slug: string; name: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.slug === "string" && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Remembers the school whose student sign-in page this device last used. */
export function RememberSchool({ slug, name }: { slug: string; name: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ slug, name }));
    } catch {}
  }, [slug, name]);
  return null;
}

export function StudentChoice({ className }: { className: string }) {
  const raw = useSyncExternalStore(noop, () => localStorage.getItem(KEY), () => null);
  const last = raw ? read() : null;
  if (last) {
    return (
      <Link href={`/s/${last.slug}/login`} className={className}>
        <span className="text-base font-extrabold">Student</span>
        <span className="text-sm text-ink-2">Sign in at {last.name}</span>
      </Link>
    );
  }
  return (
    <div className={className}>
      <span className="text-base font-extrabold">Student</span>
      <span className="text-sm text-ink-2">Open the sign-in link your school gave you (it&apos;s on your exam slip). The app remembers your school after that.</span>
    </div>
  );
}

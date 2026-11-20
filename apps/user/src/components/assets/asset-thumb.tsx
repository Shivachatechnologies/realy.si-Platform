"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const RATIO: Record<string, string> = { "1:1": "1 / 1", "3:2": "3 / 2", "2:3": "2 / 3" };

/** Lazy, responsive artwork thumbnail: reserves its aspect ratio, shimmers until decoded, fades in. */
export function AssetThumb({ src, alt, ratio = "1:1", className, sizes = "(min-width: 1024px) 25vw, 50vw" }: { src: string; alt: string; ratio?: string; className?: string; sizes?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn("relative block overflow-hidden rounded-xl bg-muted", !loaded && !failed && "shimmer", className)} style={{ aspectRatio: RATIO[ratio] ?? "1 / 1" }}>
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin authenticated bytes; next/image cannot forward the session
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          sizes={sizes}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn("absolute inset-0 size-full object-cover transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]", loaded ? "scale-100 opacity-100" : "scale-[1.03] opacity-0")}
        />
      )}
    </span>
  );
}

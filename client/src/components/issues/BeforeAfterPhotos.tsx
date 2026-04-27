"use client";

import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface BeforeAfterPhotosProps {
  beforeUrl?: string | null;
  afterUrl?: string | null;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
  imageClassName?: string;
}

function PhotoPanel({
  label,
  url,
  imageClassName,
}: {
  label: string;
  url?: string | null;
  imageClassName?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="overflow-hidden rounded-lg border bg-muted/40">
        {url ? (
          <img
            src={url}
            alt={label}
            className={cn(
              "h-36 w-full object-cover sm:h-40",
              imageClassName
            )}
          />
        ) : (
          <div className="flex h-36 w-full items-center justify-center gap-2 text-sm text-muted-foreground sm:h-40">
            <ImageOff className="h-4 w-4" />
            <span>No photo</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function BeforeAfterPhotos({
  beforeUrl,
  afterUrl,
  beforeLabel = "Before",
  afterLabel = "After",
  className,
  imageClassName,
}: BeforeAfterPhotosProps) {
  if (!beforeUrl && !afterUrl) {
    return null;
  }

  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
      <PhotoPanel
        label={beforeLabel}
        url={beforeUrl}
        imageClassName={imageClassName}
      />
      <PhotoPanel
        label={afterLabel}
        url={afterUrl}
        imageClassName={imageClassName}
      />
    </div>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

// Minimal, no extra Radix dependency needed for a plain form label (unlike
// button.tsx's asChild, there's no "render as a different element" case to
// support here).
export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => {
    return (
      <label
        className={cn(
          "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Label.displayName = "Label";

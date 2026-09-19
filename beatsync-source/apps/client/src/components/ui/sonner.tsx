"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "dark" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-neutral-800 group-[.toaster]:text-neutral-100 group-[.toaster]:border group-[.toaster]:border-neutral-700/50 group-[.toaster]:rounded-md group-[.toaster]:shadow-md group-[.toaster]:p-3 group-[.toaster]:text-sm",
          description: "group-[.toast]:text-neutral-400 group-[.toast]:text-xs",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:px-3 group-[.toast]:py-1 group-[.toast]:rounded-md group-[.toast]:text-xs group-[.toast]:font-medium hover:group-[.toast]:bg-primary/90",
          cancelButton:
            "group-[.toast]:bg-neutral-700 group-[.toast]:text-neutral-300 group-[.toast]:px-3 group-[.toast]:py-1 group-[.toast]:rounded-md group-[.toast]:text-xs group-[.toast]:font-medium hover:group-[.toast]:bg-neutral-600",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

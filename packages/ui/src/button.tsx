import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", ...props }: ButtonProps) {
  const className =
    variant === "primary"
      ? "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white"
      : "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900";

  return <button className={className} {...props} />;
}

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "outline" | "dark" | "disabled";
type Size = "lg" | "md";

const base =
  "inline-flex items-center justify-center rounded-pill text-center transition-[background-color,color,border-color,transform] duration-200 ease-out select-none";

/** 點擊區最小 56×56px（README §5） */
const sizes: Record<Size, string> = {
  lg: "min-h-[56px] px-[40px] py-[15px] text-[19px]",
  md: "min-h-[56px] px-[32px] py-[14px] text-[18px]",
};

const variants: Record<Variant, string> = {
  primary: "bg-caramel-ink text-white hover:bg-caramel-dk",
  outline:
    "border-2 border-sand-400 text-brown-900 hover:bg-[#F5E7CE] bg-transparent",
  dark: "bg-brown-900 text-white hover:bg-caramel-ink",
  disabled: "bg-sand-400 text-white cursor-not-allowed pointer-events-none",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
}: {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return [
    base,
    sizes[size],
    variants[variant],
    fullWidth ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

type LinkButtonProps = {
  href: string;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;

export function LinkButton({
  href,
  variant,
  size,
  fullWidth,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  const cls = buttonClass({ variant, size, fullWidth, className });
  if (href.startsWith("tel:") || href.startsWith("http") || href.startsWith("mailto:")) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

type ButtonProps = {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
} & ComponentProps<"button">;

export function Button({
  variant,
  size,
  fullWidth,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={buttonClass({ variant, size, fullWidth, className })}
      {...rest}
    />
  );
}

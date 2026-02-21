import Link from "next/link";
import { Button } from "@flowstate/ui";

type HeaderLink = {
  href: string;
  label: string;
};

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  links: HeaderLink[];
  minimal?: boolean;
};

export function PageHeader({ eyebrow, title, description, links, minimal = true }: PageHeaderProps) {
  return (
    <header className="hero compact space-y-2">
      {!minimal && eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 className="max-w-4xl text-balance">{title}</h1>
      {!minimal && description ? <p className="subtitle">{description}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {links.map((link) => (
          <Button key={link.href} asChild size="sm" variant="ghost">
            <Link href={link.href}>{link.label}</Link>
          </Button>
        ))}
      </div>
    </header>
  );
}

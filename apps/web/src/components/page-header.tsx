import Link from "next/link";
import { Badge, Button } from "@flowstate/ui";

type HeaderLink = {
  href: string;
  label: string;
};

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  links: HeaderLink[];
};

export function PageHeader({ eyebrow, title, description, links }: PageHeaderProps) {
  return (
    <header className="hero compact panel space-y-4">
      <Badge variant="secondary">{eyebrow}</Badge>
      <h1 className="max-w-4xl text-balance">{title}</h1>
      <p className="subtitle">{description}</p>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <Button key={link.href} asChild size="sm" variant="outline">
            <Link href={link.href}>{link.label}</Link>
          </Button>
        ))}
      </div>
    </header>
  );
}

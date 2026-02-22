import Link from "next/link";

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
      {links.length > 0 ? (
        <nav aria-label="Breadcrumb" className="hidden items-center gap-2 text-xs font-medium text-muted-foreground md:flex">
          {links.map((link, index) => (
            <span key={link.href} className="inline-flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              <Link href={link.href} className="hover:text-foreground">
                {link.label}
              </Link>
            </span>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

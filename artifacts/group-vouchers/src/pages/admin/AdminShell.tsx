import { Link, useLocation, Redirect } from "wouter";
import { useGetAdminMe } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Spinner } from "@/components/ui/spinner";
import {
  LayoutGrid,
  Receipt,
  Ticket,
  Image,
  Users,
  Tag,
  Contact,
  MessageCircle,
} from "lucide-react";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutGrid },
  { href: "/admin/orders", label: "Orders & Payments", icon: Receipt },
  { href: "/admin/group-orders", label: "Group Orders", icon: Users },
  { href: "/admin/vouchers", label: "Vouchers", icon: Ticket },
  { href: "/admin/pricing", label: "Pricing", icon: Tag },
  { href: "/admin/gallery", label: "Gallery", icon: Image },
  { href: "/admin/whatsapp/audiences", label: "WA Audiences", icon: Contact },
  { href: "/admin/whatsapp/campaigns", label: "WA Broadcasts", icon: MessageCircle },
];

function AdminNav() {
  const [location] = useLocation();
  return (
    <nav className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/admin"
            ? location === "/admin" || location === "/admin/"
            : location.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Client-side staff guard. Calls the staff-only `/admin/me` endpoint: while it
 * loads we show a spinner; if it fails (not signed in as staff / not on the
 * allow-list) we redirect away from the admin area; on success the admin
 * section renders with its sub-navigation.
 */
export function AdminShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { data, isLoading, isError } = useGetAdminMe();

  if (isLoading) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner className="h-8 w-8 text-primary" />
        </div>
      </Layout>
    );
  }

  if (isError || !data?.staff) {
    return <Redirect to="/" />;
  }

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-3">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.28em] text-accent-foreground">
            Staff Admin · {data.email}
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl text-primary">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </header>
        <AdminNav />
        {children}
      </div>
    </Layout>
  );
}

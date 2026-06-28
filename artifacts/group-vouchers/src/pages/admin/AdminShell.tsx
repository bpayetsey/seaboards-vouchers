import { Link, useLocation, Redirect } from "wouter";
import { useGetAdminMe, useGetAdminInboxUnreadCount } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LayoutGrid,
  Receipt,
  Ticket,
  Image,
  Users,
  Tag,
  Contact,
  MessageCircle,
  Inbox,
  Mail,
  Send,
  CalendarDays,
} from "lucide-react";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutGrid },
  { href: "/admin/orders", label: "Orders & Payments", icon: Receipt },
  { href: "/admin/group-orders", label: "Group Orders", icon: Users },
  { href: "/admin/calendar", label: "Day-Pass Calendar", icon: CalendarDays },
  { href: "/admin/vouchers", label: "Vouchers", icon: Ticket },
  { href: "/admin/pricing", label: "Pricing", icon: Tag },
  { href: "/admin/gallery", label: "Gallery", icon: Image },
  { href: "/admin/whatsapp/audiences", label: "WA Audiences", icon: Contact },
  { href: "/admin/whatsapp/campaigns", label: "WA Broadcasts", icon: MessageCircle },
  { href: "/admin/inbox", label: "Inbox", icon: Inbox },
  { href: "/admin/email/audiences", label: "Email Audiences", icon: Mail },
  { href: "/admin/email/campaigns", label: "Email Campaigns", icon: Send },
];

function AdminNav() {
  const [location, setLocation] = useLocation();
  const { data: unreadData } = useGetAdminInboxUnreadCount({
    query: {
      refetchInterval: 60_000,
      staleTime: 30_000,
      // queryKey is required by the type but orval hooks always supply it internally;
      // cast avoids the spurious missing-required-property error.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
  const unreadCount = unreadData?.count ?? 0;

  const isActive = (href: string) =>
    href === "/admin"
      ? location === "/admin" || location === "/admin/"
      : location.startsWith(href);

  const current = NAV.find((n) => isActive(n.href)) ?? NAV[0];
  const badge = (
    <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none">
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  );

  return (
    <>
      {/* Mobile: compact dropdown so the many sections stay reachable */}
      <div className="sm:hidden">
        <Select value={current.href} onValueChange={(href) => setLocation(href)}>
          <SelectTrigger className="w-full bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NAV.map(({ href, label, icon: Icon }) => (
              <SelectItem key={href} value={href}>
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {label}
                  {href === "/admin/inbox" && unreadCount > 0 ? badge : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: full wrap nav */}
      <nav className="hidden sm:flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          const showBadge = href === "/admin/inbox" && unreadCount > 0;
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
              {showBadge && badge}
            </Link>
          );
        })}
      </nav>
    </>
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
